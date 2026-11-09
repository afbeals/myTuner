import assert from "node:assert/strict";
import { nativeVisual } from "./native-visual.mjs";
import { createServer, request } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
const tracksOnly = process.env.MYTUNER_TV_TRACKS_ONLY === "1";
const tracksFinished = Symbol("tracks-finished");
const accessibilityOnly = process.env.MYTUNER_TV_ACCESSIBILITY_ONLY === "1";
const accessibilityFinished = Symbol("accessibility-finished");
const visualOnly = process.env.MYTUNER_TV_VISUAL_ONLY === "1";
const visualEnabled = visualOnly || process.env.MYTUNER_TV_VISUAL === "1";
const visualFinished = Symbol("visual-finished");
const visualChecks = [];
const availabilityOnly = process.env.MYTUNER_TV_AVAILABILITY_ONLY === "1";
const run = promisify(execFile),
  adb = process.env.MYTUNER_ADB ?? "adb",
  serial = process.env.MYTUNER_TV_SERIAL ?? "emulator-5554",
  base = process.env.MYTUNER_TV_TEST_SERVER ?? "http://127.0.0.1:8787";
assert.match(
  serial,
  /^emulator-\d+$/,
  "This synthetic smoke script targets emulators only.",
);
async function shell(...args) {
  return (
    await run(adb, ["-s", serial, "shell", ...args], {
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout;
}
async function key(...keys) {
  for (const k of keys) await shell("input", "keyevent", String(k));
  await delay(250);
}
async function tree() {
  let dumped = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      dumped = await shell(
        "timeout",
        "12",
        "uiautomator",
        "dump",
        "/sdcard/mytuner-ui.xml",
      );
    } catch (error) {
      // Android can finish writing the hierarchy but leave the dump VM alive.
      // The device-side timeout reaps it before another read-only inspection.
      if (error.code === 124 && /dumped to:/.test(error.stdout ?? ""))
        dumped = error.stdout;
      else if (error.code === 124 && attempt === 0) continue;
      else throw error;
    }
    break;
  }
  assert.match(dumped, /dumped to:/, "A fresh hierarchy was written");
  return (
    await run(
      adb,
      ["-s", serial, "exec-out", "cat", "/sdcard/mytuner-ui.xml"],
      { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
    )
  ).stdout;
}
async function until(pattern) {
  let xml;
  for (let i = 0; i < 12; i++) {
    xml = await tree();
    if (pattern.test(xml)) return xml;
    await delay(300);
  }
  throw new Error(`TV screen did not match ${pattern}: ${xml?.slice(-3000)}`);
}
async function focusLabel(label, initialXml) {
  for (let i = 0; i < 18; i++) {
    const xml = i === 0 && initialXml ? initialXml : await tree();
    const rows = [...xml.matchAll(/<node\b[^>]+>/g)].map(([raw]) => {
      const attr = (name) =>
        raw.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
      const bounds = attr("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      return {
        text: attr("text"),
        resourceId: attr("resource-id"),
        focused: attr("focused") === "true",
        selected: attr("selected") === "true",
        x: bounds ? (+bounds[1] + +bounds[3]) / 2 : 0,
        y: bounds ? (+bounds[2] + +bounds[4]) / 2 : 0,
      };
    });
    const target = rows.find(
      (r) => r.text.toLowerCase() === label.toLowerCase(),
    );
    // Android list menus focus their container and select the active row.
    const current = rows.find((r) => r.selected) ?? rows.find((r) => r.focused);
    if (!target && i < 5) {
      await delay(200);
      continue;
    }
    assert.ok(target, `Missing remote target ${label}`);
    if (target.focused || target.selected) return;
    if (!current) {
      await key(20);
      continue;
    }
    // Visible Android dialog rows are ordered. Batch real D-pad presses so
    // hierarchy dumps do not consume the held-response timeout between rows.
    // Re-read afterward to verify focus; never use touch or invoke the handler.
    const menuRows = rows.filter((r) => r.resourceId === "android:id/text1");
    const from = menuRows.indexOf(current),
      to = menuRows.indexOf(target);
    if (from >= 0 && to >= 0) {
      await key(...Array(Math.abs(to - from)).fill(to > from ? 20 : 19));
      continue;
    }
    const dx = target.x - current.x,
      dy = target.y - current.y;
    await key(Math.abs(dy) > 20 ? (dy > 0 ? 20 : 19) : dx > 0 ? 22 : 21);
  }
  throw Error(`Could not reach ${label} using the remote`);
}
async function clickLabel(label, initialXml) {
  await focusLabel(label, initialXml);
  await key(23);
}
async function capture(name) {
  const { stdout } = await run(
    adb,
    ["-s", serial, "exec-out", "screencap", "-p"],
    { encoding: "buffer", maxBuffer: 10 * 1024 * 1024, timeout: 30000 },
  );
  await writeFile(`test-results/tv/${name}.png`, stdout);
  console.log(`Captured ${name}`);
  if (
    visualEnabled &&
    [
      "01-connect",
      "03-profiles",
      "04-pin",
      "05-guide",
      "06-join-error",
      "06-playing",
      "07-paused",
      "07-browse-paused",
      "07-caption-style",
    ].includes(name)
  ) {
    assert.equal(
      (await shell("getprop", "ro.build.version.sdk")).trim(),
      "34",
      "Native baselines target the documented API34 emulator only",
    );
    let variant = name;
    if (name === "07-browse-paused") {
      const dialog = await tree();
      // Both synthetic episodes legitimately rotate through Now/Next. Match a
      // reviewed specimen for that exact line instead of masking the content.
      if (dialog.includes("Now: Maple Street · Next: The Last Platform"))
        variant += "-alternate";
      else
        assert.ok(
          dialog.includes("Now: The Last Platform · Next: Maple Street"),
          "Browse exposes the expected synthetic now/next pair",
        );
    }
    visualChecks.push(
      await nativeVisual(name, `test-results/tv/${name}.png`, {
        update: process.env.MYTUNER_UPDATE_TV_BASELINES === "1",
        variant,
      }),
    );
    console.log(`Native visual ${visualChecks.at(-1).status}: ${name}`);
  }
}
async function assertVideoPixels(name) {
  const { stdout: pixels } = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      `test-results/tv/${name}.png`,
      "-vf",
      "crop=iw/2:ih/4:iw/4:ih/8,scale=1:1",
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 30000 },
  );
  assert.ok(
    [...pixels].some((value) => value > 20),
    `${name}: synthetic video must render visible pixels, not a black surface`,
  );
}
// Loopback-only fault injection: no test endpoints or outage switches in the application.
let heldProfileSelection = null,
  holdProfileSelection = false,
  profileStartups = 0;
let failPairPoll = true,
  failJoin = true,
  failPoll = false,
  controlFault = null,
  holdCaption = false,
  heldCaption = null,
  holdMedia = false,
  heldMedia = null,
  forceUnavailable = false;
const observations = {
  pairPollFailures: 0,
  joinFailures: 0,
  pollFailures: 0,
  controlFailures: 0,
  captionFailures: 0,
  captionRequests: 0,
  negotiations: [],
  events: [],
  descriptors: [],
  deliveries: [],
  languageAliases: [],
  externalCaptions: [],
  audioSegments: [],
};
const proxy = createServer((incoming, outgoing) => {
  const path = incoming.url ?? "/";
  if (path === "/api/auth/pairings/poll" && failPairPoll) {
    failPairPoll = false;
    observations.pairPollFailures++;
    incoming.resume();
    outgoing.writeHead(503, { "content-type": "application/json" });
    outgoing.end(
      JSON.stringify({ error: "Synthetic transient pairing outage" }),
    );
    return;
  }
  if (path === "/api/review-caption-pause.vtt") {
    incoming.resume();
    const s = observations.descriptors.at(-1),
      e = s.playback.entry;
    const sourceMs = e.offsetMs + s.positionMs - e.startMs;
    assert.ok(sourceMs > 2000, "paused cue is away from source time zero");
    const timestamp = (ms) => new Date(ms).toISOString().slice(11, 23);
    outgoing.writeHead(200, { "content-type": "text/vtt" });
    outgoing.end(
      `WEBVTT\n\n${timestamp(Math.max(1, sourceMs - 1000))} --> ${timestamp(sourceMs + 60000)}\nPaused caption uses retained session time\n`,
    );
    return;
  }
  if (path.startsWith("/api/review-caption")) {
    incoming.resume();
    observations.captionRequests++;
    if (path.includes("caption-fail")) {
      observations.captionFailures++;
      outgoing.writeHead(503, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "Synthetic caption outage" }));
    } else {
      const send = (text) => {
        outgoing.writeHead(200, { "content-type": "text/vtt" });
        outgoing.end(`WEBVTT\n\n00:00:00.000 --> 01:00:00.000\n${text}\n`);
      };
      if (holdCaption) {
        holdCaption = false;
        // Keep the body incomplete while delivering valid WebVTT comments.
        // This tests a late successful response across the real boundary,
        // independently of the HTTP client's 15-second idle-read timeout.
        outgoing.writeHead(200, { "content-type": "text/vtt" });
        outgoing.write("WEBVTT\n\n");
        const heartbeat = setInterval(
          () => outgoing.write("NOTE Held synthetic caption response\n\n"),
          2000,
        );
        const deadline = setTimeout(() => outgoing.destroy(), 60000);
        const clearHold = () => {
          clearInterval(heartbeat);
          clearTimeout(deadline);
        };
        outgoing.once("close", clearHold);
        heldCaption = {
          response: outgoing,
          startedMs: Date.now(),
          release: () => {
            clearHold();
            outgoing.end(
              "00:00:00.000 --> 01:00:00.000\nOld episode caption\n",
            );
          },
        };
      } else send("Current episode caption");
    }
    return;
  }
  if (incoming.method === "POST" && path === "/api/playback/startup")
    profileStartups++;
  if (
    incoming.method === "POST" &&
    /\/api\/playback\/profiles\/[^/]+\/select$/.test(path) &&
    holdProfileSelection
  ) {
    holdProfileSelection = false;
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => {
      heldProfileSelection = {
        release: async () => {
          const response = await fetch(new URL(path, base), {
            method: "POST",
            headers: {
              authorization: incoming.headers.authorization,
              "content-type": "application/json",
            },
            body: Buffer.concat(chunks),
          });
          outgoing.writeHead(response.status, {
            "content-type": "application/json",
          });
          outgoing.end(await response.text());
        },
      };
    });
    return;
  }
  if (
    incoming.method === "POST" &&
    path === "/api/playback/sessions" &&
    failJoin
  ) {
    failJoin = false;
    observations.joinFailures++;
    incoming.resume();
    outgoing.writeHead(503, { "content-type": "application/json" });
    outgoing.end(JSON.stringify({ error: "Synthetic join outage" }));
    return;
  }
  if (
    incoming.method === "GET" &&
    /^\/api\/playback\/sessions\/[^/]+$/.test(path) &&
    failPoll
  ) {
    observations.pollFailures++;
    incoming.resume();
    outgoing.writeHead(503, { "content-type": "application/json" });
    outgoing.end(JSON.stringify({ error: "Synthetic poll outage" }));
    return;
  }
  const fault =
    incoming.method === "POST" &&
    controlFault &&
    path.endsWith(`/${controlFault.action}`)
      ? controlFault
      : null;
  if (fault) controlFault = null;
  if (fault && !fault.apply) {
    observations.controlFailures++;
    incoming.resume();
    outgoing.writeHead(503, { "content-type": "application/json" });
    outgoing.end(JSON.stringify({ error: "Synthetic control outage" }));
    return;
  }
  if (incoming.method === "POST" && path.endsWith("/negotiate"))
    observations.negotiations.push(path);
  let body = "";
  if (incoming.method === "POST" && path.endsWith("/events")) {
    incoming.on("data", (chunk) => {
      body += chunk;
    });
    incoming.on("end", () => observations.events.push(JSON.parse(body)));
  }
  const upstream = request(
    new URL(path, base),
    {
      method: incoming.method,
      headers: { ...incoming.headers, host: new URL(base).host },
    },
    (response) => {
      if (/\/subtitles\/1\d+\.vtt/.test(path))
        observations.externalCaptions.push({
          path,
          status: response.statusCode,
        });
      if (path.includes(".ts?audioTrack=2") && response.statusCode === 200)
        observations.audioSegments.push(path);
      if (
        holdMedia &&
        incoming.method === "GET" &&
        /^\/api\/profiles\/[^/]+\/media\/[^/]+$/.test(path) &&
        response.statusCode === 200
      ) {
        holdMedia = false;
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          heldMedia = () => {
            outgoing.writeHead(200, { "content-type": "application/json" });
            outgoing.end(data);
          };
        });
        return;
      }
      if (fault?.apply && response.statusCode === 200) {
        response.resume();
        response.on("end", () => {
          observations.controlFailures++;
          outgoing.writeHead(503, { "content-type": "application/json" });
          outgoing.end(
            JSON.stringify({ error: "Synthetic lost control response" }),
          );
        });
        return;
      }
      if (
        incoming.method === "POST" &&
        path.endsWith("/negotiate") &&
        response.statusCode === 200
      ) {
        let raw = "";
        response.on("data", (chunk) => (raw += chunk));
        response.on("end", () => {
          const value = JSON.parse(raw);
          observations.deliveries.push(value);
          if (tracksOnly) {
            const alias =
              observations.languageAliases.length % 2 === 0 ? "eng" : "en";
            const captions = value.tracks.filter(
              (t) => t.type === "subtitle" && t.url,
            );
            if (captions.length) {
              captions.forEach((t) => {
                t.language = alias;
              });
              observations.languageAliases.push(alias);
            }
          }
          if (!tracksOnly)
            value.tracks.push(
              {
                index: 92,
                type: "subtitle",
                codec: "webvtt",
                title: "Synthetic failed captions",
                url: "/api/review-caption-fail.vtt",
              },
              {
                index: 93,
                type: "subtitle",
                codec: "webvtt",
                title: "Synthetic delayed captions",
                url: "/api/review-caption.vtt",
              },
              {
                index: 94,
                type: "subtitle",
                codec: "webvtt",
                title: "Synthetic paused-position captions",
                url: "/api/review-caption-pause.vtt",
              },
            );
          outgoing.writeHead(200, { "content-type": "application/json" });
          outgoing.end(JSON.stringify(value));
        });
        return;
      }
      if (
        (incoming.method === "GET" &&
          /^\/api\/playback\/sessions\/[^/]+$/.test(path)) ||
        (incoming.method === "POST" && path === "/api/playback/sessions")
      ) {
        let descriptor = "";
        response.on("data", (chunk) => (descriptor += chunk));
        response.on("end", () => {
          if (response.statusCode === 200 || response.statusCode === 201) {
            const value = JSON.parse(descriptor);
            if (forceUnavailable) {
              value.available = false;
            }
            observations.descriptors.push(value);
            outgoing.writeHead(200, { "content-type": "application/json" });
            outgoing.end(JSON.stringify(value));
          } else {
            outgoing.writeHead(response.statusCode, {
              "content-type": "application/json",
            });
            outgoing.end(descriptor);
          }
        });
        return;
      }
      outgoing.writeHead(response.statusCode, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.on("aborted", () => upstream.destroy());
  outgoing.on("close", () => {
    if (!outgoing.writableEnded) upstream.destroy();
  });
  incoming.pipe(upstream);
});
await new Promise((resolve, reject) => {
  proxy.once("error", reject);
  proxy.listen(8789, "127.0.0.1", resolve);
});
async function observed(predicate, label, timeoutMs = 15000) {
  for (let i = 0; i < Math.ceil(timeoutMs / 150); i++) {
    if (predicate()) return;
    await delay(250);
  }
  throw Error(`TV recovery observation failed: ${label}`);
}
async function chooseCaptions(index) {
  await clickLabel("Subtitles");
  const menu = await until(/Synthetic delayed captions/);
  await clickLabel(
    [
      "",
      "Synthetic failed captions",
      "Synthetic delayed captions",
      "Synthetic paused-position captions",
    ][index],
    menu,
  );
}
async function configureTracksFixture(page, profile) {
  return page.evaluate(async (profileId) => {
    const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
    const mutate = async (path, method, body) => {
      const response = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw Error(await response.text());
      return response.status === 204 ? null : response.json();
    };
    const sources = await (await fetch("/api/sources")).json(),
      source = sources.find((s) => s.kind === "shows");
    const ads = await mutate("/api/sources", "POST", {
      name: "Native synthetic ads",
      kind: "commercials",
      recursive: true,
      root: source.rootPath.replace(/\/media$/, "/commercials"),
    });
    await mutate(`/api/sources/${ads.id}/scan`, "POST", {});
    await mutate(`/api/profiles/${profileId}/grants`, "POST", {
      sourceId: ads.id,
      subtree: "",
    });
    const selection = await mutate(
      `/api/profiles/${profileId}/selection`,
      "POST",
      { type: "folder", sourceId: source.id, directory: "", recursive: true },
    );
    const items = [...selection.items].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    if (!items[1].path.endsWith(".mkv"))
      throw Error("Tracks mode needs MYTUNER_E2E_MIXED_FORMATS=1");
    const ch = await mutate("/api/channels", "POST", {
      profileId,
      name: "Native tracks proof",
      visibility: "private",
    });
    await mutate(
      `/api/channels/${ch.id}/programming?horizonMs=3600000`,
      "PUT",
      {
        profileId,
        seed: 42,
        groups: [
          {
            id: "mixed",
            mode: "ordered",
            selection: { type: "media", ids: items.map((i) => i.id) },
          },
        ],
        commercialSelection: {
          type: "folder",
          sourceId: ads.id,
          directory: "",
          recursive: true,
        },
        rules: {
          between: false,
          positions: [{ kind: "timestamp", value: 90000 }],
          maxClips: 1,
          maxDurationMs: 10000,
          overflowPolicy: "truncate",
          minRemainingMs: 6000,
          repeatAllowance: 20,
          maxPerBreak: 1,
          cooldownMs: 0,
        },
      },
    );
    const subscriptions = await (
      await fetch(`/api/profiles/${profileId}/channels`)
    ).json();
    for (const sub of subscriptions)
      await mutate(
        `/api/profiles/${profileId}/subscriptions/${sub.id}`,
        "DELETE",
        {},
      );
    await mutate(
      `/api/profiles/${profileId}/subscriptions/${ch.id}`,
      "PUT",
      {},
    );
    return { channelId: ch.id, first: items[0].id, second: items[1].id };
  }, profile.id);
}
async function assertCaptionVisible(text) {
  const xml = await tree();
  const nodes = [...xml.matchAll(/<node\b[^>]+>/g)].map(([raw]) => ({
    text: raw.match(/text="([^"]*)"/)?.[1] ?? "",
    bounds: (raw.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) ?? [])
      .slice(1)
      .map(Number),
  }));
  const cue = nodes.find((n) => n.text.includes(text)),
    channel = nodes.find((n) => n.text === "Native tracks proof");
  assert.ok(
    cue?.bounds.length === 4 && channel?.bounds.length === 4,
    "caption and visible controls have measured bounds",
  );
  assert.ok(
    cue.bounds[3] <= channel.bounds[1] - 16,
    "caption must be above opaque playback controls, not hidden underneath them",
  );
  assert.ok(
    cue.bounds[1] >= 0 && cue.bounds[3] > cue.bounds[1],
    "caption stays inside the display",
  );
}
async function verifyTracks(fixture) {
  await until(/content-desc="Video playing"/);
  assert.equal(observations.deliveries.at(-1).mode, "direct");
  await clickLabel("Subtitles");
  await until(/en · subfolder/);
  await clickLabel("en · subfolder (srt)");
  await until(/External fixture episode 1/);
  await assertCaptionVisible("External fixture episode 1");
  await observed(
    () => observations.externalCaptions.some((r) => r.status === 200),
    "real authenticated external caption conversion",
  );
  await clickLabel("Pause");
  await until(/text="Resume"/);
  await observed(
    () => observations.descriptors.at(-1)?.paused,
    "authoritative pause",
  );
  const paused = observations.descriptors.at(-1),
    events = observations.events.length;
  await delay(1200);
  assert.match(await tree(), /External fixture episode 1/);
  await assertCaptionVisible("External fixture episode 1");
  assert.equal(observations.descriptors.at(-1).positionMs, paused.positionMs);
  assert.equal(
    observations.events.length,
    events,
    "paused TV sends no new delivery events",
  );
  await clickLabel("Resume");
  await until(/content-desc="Video playing"/);
  console.log("TV external caption and pause verified");
  await clickLabel("Audio");
  await until(/text="fra"/);
  await clickLabel("fra");
  await observed(
    () => observations.audioSegments.length > 0,
    "real selected-audio HLS segments",
    30000,
  );
  await until(/External fixture episode 1/);
  await clickLabel("Go Live");
  await until(/content-desc="Video playing"/);
  await observed(
    () => observations.descriptors.at(-1)?.playback.entry.kind === "commercial",
    "actual program to commercial",
    135000,
  );
  assert.doesNotMatch(await tree(), /External fixture episode 1/);
  await until(/content-desc="Video playing"/);
  console.log("TV selected audio and program-to-commercial boundary verified");
  const ad = observations.descriptors.at(-1).playback.entry;
  assert.equal(ad.endMs - ad.startMs, 10000, "oversized ad cut to ten seconds");
  await observed(
    () => observations.descriptors.at(-1)?.playback.entry.kind === "program",
    "actual commercial to program",
    20000,
  );
  assert.equal(
    observations.descriptors.at(-1).playback.entry.mediaId,
    fixture.first,
  );
  assert.ok(observations.descriptors.at(-1).playback.entry.offsetMs >= 90000);
  await until(/External fixture episode 1/);
  const resumedEvents = observations.events.length;
  await observed(
    () => observations.events.length > resumedEvents,
    "real advancing program after commercial",
  );
  await observed(
    () =>
      observations.descriptors.at(-1)?.playback.entry.mediaId ===
      fixture.second,
    "MP4 to MKV interval",
    70000,
  );
  await until(/External fixture episode 2/);
  await until(/content-desc="Video playing"/);
  assert.equal(observations.deliveries.at(-1).mode, "hls", "MKV uses HLS");
  const nextEvents = observations.events.length;
  await observed(
    () => observations.events.length > nextEvents,
    "actual advancing mixed-format playback",
  );
  await assertCaptionVisible("External fixture episode 2");
  assert.ok(
    observations.languageAliases.includes("eng") &&
      observations.languageAliases.includes("en"),
    "Real caption selections survive ISO639 three/two-letter alias changes",
  );
  await capture("09-external-mixed-format");
  await assertVideoPixels("09-external-mixed-format");
  await writeFile(
    "test-results/tv/tracks-result.json",
    JSON.stringify(
      {
        passed: true,
        hardware: false,
        mode: "tracks",
        externalCaptions: observations.externalCaptions.length,
        selectedAudioSegments: observations.audioSegments.length,
        languageAliases: observations.languageAliases,
        deliveredIntervals: observations.events.length,
        steps: [
          "browser-approved pairing and PIN",
          "direct MP4 external captions",
          "pause retains source-time cue without delivery",
          "alternate audio authenticated HLS",
          "Go Live",
          "program to truncated commercial clears captions",
          "commercial to source-offset program restores captions",
          "MP4 to MKV HLS advances with new episode captions",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "TV external-caption, alternate-audio, commercial and mixed-format checks passed.",
  );
}
const browser = await chromium.launch(),
  page = await browser.newPage();
try {
  await mkdir("test-results/tv", { recursive: true });
  await rm("test-results/tv/result.json", { force: true });
  await page.goto(base);
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation").waitFor();
  const profile = await page.evaluate(async () => {
    const rows = await (await fetch("/api/profiles")).json();
    return rows.find((p) => p.name === "Living Room");
  });
  assert.ok(profile);
  await page.evaluate(async (p) => {
    const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
    const r = await fetch(`/api/profiles/${p.id}/pin`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ pin: "1234" }),
    });
    if (!r.ok) throw Error("Cannot set synthetic PIN");
  }, profile);
  // A cold-launch baseline starts from the launcher, with no old dialog/IME animation.
  await shell("am", "force-stop", "tv.mytuner.app");
  await key(3);
  await delay(1000);
  await shell("pm", "clear", "tv.mytuner.app");
  await shell("am", "start", "-W", "-n", "tv.mytuner.app/.MainActivity");
  await until(/Where is your myTuner server/);
  await delay(400);
  const initialIme = await shell("dumpsys", "input_method");
  if (
    /mInputShown=true|isInputViewShown=true|mIsInputViewShown=true/.test(
      initialIme,
    )
  ) {
    await key(4);
    // IME/system window dismissal can outlast the key injection itself.
    await delay(1000);
    await until(/Where is your myTuner server/);
  }
  await capture("01-connect");
  await key(123, ...Array(7).fill(67));
  await shell("input", "text", "http://10.0.2.2:8789");
  let xml = await tree();
  const ime = await shell("dumpsys", "input_method");
  if (/mInputShown=true|isInputViewShown=true|mIsInputViewShown=true/.test(ime))
    await key(4);
  await key(20);
  xml = await tree();
  assert.match(xml, /<node[^>]*text="Connect"[^>]*focused="true"/);
  await key(23);
  xml = await until(/[A-F0-9]{5} [A-F0-9]{5}/);
  await capture("02-pairing");
  const code = xml.match(/text="([A-F0-9]{5} [A-F0-9]{5})"/)[1];
  await page.goto(`${base}/#connect-tv`);
  await page.getByLabel("TV connection code").fill(code);
  await page.getByRole("button", { name: "Review TV", exact: true }).click();
  await page.getByRole("button", { name: "Approve TV", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "TV approved" }).waitFor();
  await until(/Living Room.*PIN protected/);
  assert.equal(
    observations.pairPollFailures,
    1,
    "pairing recovers the transient poll error",
  );
  await capture("03-profiles");
  if (!visualOnly && !accessibilityOnly && !tracksOnly && !availabilityOnly) {
    const startupsBefore = profileStartups;
    holdProfileSelection = true;
    await key(23);
    await observed(
      () => heldProfileSelection !== null,
      "held profile selection",
    );
    await clickLabel("Retry profiles");
    await delay(500);
    assert.equal(
      profileStartups,
      startupsBefore,
      "rebuilt profile startup waits for the old selection request",
    );
    await heldProfileSelection.release();
    heldProfileSelection = null;
    await until(/Living Room.*PIN protected/);
  }
  await key(23);
  await until(/Unlock Living Room/);
  await capture("04-pin");
  if (visualOnly) throw visualFinished;
  const tracksFixture = tracksOnly
    ? await configureTracksFixture(page, profile)
    : null;
  await key(23, 22, 23, 22, 23, 20, 21, 21, 23, 20, 20, 22, 22, 23);
  await until(/On your channels/);
  await capture("05-guide");
  if (accessibilityOnly) {
    const previousScale = (
      await shell("settings", "get", "system", "font_scale")
    ).trim();
    const previousServices = (
      await shell("settings", "get", "secure", "enabled_accessibility_services")
    ).trim();
    const previousEnabled = (
      await shell("settings", "get", "secure", "accessibility_enabled")
    ).trim();
    const longName =
      "Living Room with an exceptionally long household profile name for accessibility";
    try {
      await page.evaluate(
        async ({ id, name }) => {
          const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
          const r = await fetch(`/api/profiles/${id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken,
            },
            body: JSON.stringify({ name }),
          });
          if (!r.ok) throw Error(await r.text());
        },
        { id: profile.id, name: longName },
      );
      await shell("settings", "put", "system", "font_scale", "1.3");
      await shell("am", "force-stop", "tv.mytuner.app");
      await shell("am", "start", "-W", "-n", "tv.mytuner.app/.MainActivity");
      await until(/Who.s watching/);
      await key(23);
      await until(/Unlock Living Room with/);
      await key(23, 22, 23, 22, 23, 20, 21, 21, 23, 20, 20, 22, 22, 23);
      const large = await until(/On your channels/);
      assert.ok(
        large.includes(longName),
        "Long profile name remains in the accessibility hierarchy",
      );
      await capture("10-large-guide");
      await writeFile("test-results/tv/10-large-guide.xml", large);
      const service =
        "com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService";
      const services =
        previousServices && previousServices !== "null"
          ? `${previousServices}:${service}`
          : service;
      await shell(
        "settings",
        "put",
        "secure",
        "enabled_accessibility_services",
        services,
      );
      await shell("settings", "put", "secure", "accessibility_enabled", "1");
      await delay(3000);
      const serviceState = await shell("dumpsys", "accessibility");
      assert.match(
        serviceState,
        /Bound services:.*TalkBackService/s,
        "TalkBack service is bound",
      );
      await writeFile("test-results/tv/10-talkback-service.txt", serviceState);
      await key(22, 21);
      const spokenGuide = await until(/On your channels/);
      assert.match(
        spokenGuide,
        /<node[^>]*clickable="true"[^>]*focusable="true"[^>]*focused="true"/,
        "Remote controls remain focusable with TalkBack active",
      );
      await capture("10-talkback-guide");
      await writeFile(
        "test-results/tv/accessibility-result.json",
        JSON.stringify(
          {
            hardware: false,
            fontScale: 1.3,
            longNameInHierarchy: true,
            talkBackBound: true,
            remoteFocus: true,
            audibleSpeechReviewed: false,
          },
          null,
          2,
        ),
      );
      console.log(
        "Native large-text and bound-TalkBack remote checks passed; audible speech and physical display remain manual.",
      );
    } finally {
      for (const [namespace, key, value] of [
        ["system", "font_scale", previousScale],
        ["secure", "enabled_accessibility_services", previousServices],
        ["secure", "accessibility_enabled", previousEnabled],
      ]) {
        if (value && value !== "null")
          await shell("settings", "put", namespace, key, value);
        else await shell("settings", "delete", namespace, key);
      }
    }
    throw accessibilityFinished;
  }
  await key(23);
  await until(/Synthetic join outage/);
  assert.equal(observations.joinFailures, 1);
  const joinErrorNode = [...(await tree()).matchAll(/<node\b[^>]+>/g)]
    .map(([raw]) => raw)
    .find((raw) => raw.includes('text="Synthetic join outage"'));
  assert.ok(joinErrorNode, "Join failure exposes a readable, named error");
  const errorBounds = joinErrorNode.match(
    /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/,
  );
  assert.ok(
    errorBounds && +errorBounds[4] < 450,
    "Join error stays above playback controls",
  );
  await capture("06-join-error");
  await key(22, 22, 22, 22, 22, 23);
  await until(/Orbit Patrol/);
  await until(/content-desc="Video playing"/);
  await observed(
    () => observations.descriptors.length > 0,
    "initial descriptor",
  );
  if (tracksOnly) {
    await verifyTracks(tracksFixture);
    throw tracksFinished;
  }
  if (!availabilityOnly) {
    await observed(
      () =>
        observations.descriptors.at(-1)?.playback.entry.endMs - Date.now() >
        50000,
      "enough same-entry time for poll and control recovery assertions",
      135000,
    );
    const beforePoll = observations.descriptors.at(-1),
      negotiationsBefore = observations.negotiations.length,
      eventsBefore = observations.events.length;
    failPoll = true;
    await until(/Synthetic poll outage/);
    failPoll = false;
    await observed(
      () => observations.negotiations.length > negotiationsBefore,
      "automatic delivery restart",
    );
    await observed(
      () => observations.events.length > eventsBefore,
      "actual advancing playback after poll recovery",
    );
    const afterPoll = observations.descriptors.at(-1);
    assert.equal(
      afterPoll.id,
      beforePoll.id,
      "poll recovery keeps the session",
    );
    assert.equal(
      afterPoll.playback.entry.id,
      beforePoll.playback.entry.id,
      "recover within the same program, without waiting for a transition",
    );
    await key(21, 21, 21, 21, 21);
    await delay(1000);
    await capture("06-playing");
    await assertVideoPixels("06-playing");
    xml = await tree();
    assert.doesNotMatch(
      xml,
      /Playback interrupted|Media request failed|Unable to reach/,
    );
    const beforeControl = observations.descriptors.at(-1),
      controlNegotiations = observations.negotiations.length,
      controlEvents = observations.events.length;
    controlFault = { action: "pause", apply: false };
    await key(23);
    await observed(() => observations.controlFailures === 1, "rejected Pause");
    await observed(
      () => observations.negotiations.length > controlNegotiations,
      "failed control automatically restarts delivery",
    );
    await observed(
      () => observations.events.length > controlEvents,
      "actual advancing playback after control failure",
    );
    assert.equal(observations.descriptors.at(-1).paused, false);
    assert.equal(observations.descriptors.at(-1).id, beforeControl.id);
    assert.equal(
      observations.descriptors.at(-1).playback.entry.id,
      beforeControl.playback.entry.id,
      "control recovers within the same entry",
    );
    xml = await until(/text="Pause"[^>]*clickable="true"[^>]*focused="true"/);
    const beforeLostPause = observations.negotiations.length;
    controlFault = { action: "pause", apply: true };
    await key(23);
    await observed(
      () => observations.controlFailures === 2,
      "Pause applied with lost response",
    );
    await until(/text="Resume"[^>]*clickable="true"/);
    await observed(
      () => observations.descriptors.at(-1)?.paused === true,
      "authoritative paused descriptor",
    );
    assert.equal(
      observations.negotiations.length,
      beforeLostPause,
      "lost Pause response must not resume an intentionally paused session",
    );
    await chooseCaptions(3);
    await until(/Paused caption uses retained session time/);
    await delay(1500);
    assert.match(await tree(), /Paused caption uses retained session time/);
    await key(21, 21, 21, 21, 21, 21);
    await capture("07-paused");
    await assertVideoPixels("07-paused");
    const browsingSession = observations.descriptors.at(-1).id;
    const browseNegotiations = observations.negotiations.length;
    await clickLabel("Browse channels");
    await until(/Browsing keeps your current playback/);
    await capture("07-browse-paused");
    await key(4);
    assert.equal(observations.descriptors.at(-1).id, browsingSession);
    assert.equal(observations.descriptors.at(-1).paused, true);
    assert.equal(observations.negotiations.length, browseNegotiations);
    await clickLabel("More options");
    await clickLabel("Caption style");
    await until(/Caption appearance/);
    await capture("07-caption-style");
    await key(4);
    await clickLabel("More options");
    await until(/Playback options/);
    await clickLabel("Connection help");
    await until(/Last successful health check/);
    await capture("07-connection-help");
    await key(4);
    await focusLabel("Resume");
    const pausedNegotiations = observations.negotiations.length,
      descriptorCount = observations.descriptors.length;
    failPoll = true;
    await until(/Synthetic poll outage/);
    failPoll = false;
    await observed(
      () => observations.descriptors.length > descriptorCount,
      "paused descriptor recovers",
    );
    await delay(2200);
    xml = await tree();
    assert.match(xml, /text="Resume"/);
    assert.equal(
      observations.descriptors.at(-1).paused,
      true,
      "intentional pause survives recovery",
    );
    assert.equal(
      observations.negotiations.length,
      pausedNegotiations,
      "paused recovery does not start delivery",
    );
    assert.match(
      xml,
      /Paused caption uses retained session time/,
      "paused cue survives recovered polling",
    );
    await clickLabel("Retry");
    await until(/Paused caption uses retained session time/);
    assert.equal(
      observations.negotiations.length,
      pausedNegotiations,
      "paused Retry preserves cues without media negotiation",
    );
    await clickLabel("Audio");
    await clickLabel("Default audio");
    await until(/Paused caption uses retained session time/);
    assert.equal(
      observations.negotiations.length,
      pausedNegotiations,
      "paused audio change preserves cues without delivery",
    );
    await focusLabel("Resume");
    const beforeResume = observations.descriptors.length;
    controlFault = { action: "resume", apply: false };
    await key(23);
    await observed(() => observations.controlFailures === 3, "rejected Resume");
    await observed(
      () => observations.descriptors.length > beforeResume,
      "reconcile rejected Resume",
    );
    await until(/text="Resume"[^>]*clickable="true"/);
    assert.equal(observations.descriptors.at(-1).paused, true);
    assert.equal(
      observations.negotiations.length,
      pausedNegotiations,
      "failed Resume preserves pause without delivery",
    );
    await key(23);
    await until(/text="Pause"[^>]*clickable="true"/);
    await key(23);
    await until(/text="Resume"[^>]*clickable="true"/);
    const beforeGoLive = observations.negotiations.length,
      eventsBeforeGoLive = observations.events.length;
    controlFault = { action: "goLive", apply: true };
    await key(22, 23);
    await observed(
      () => observations.controlFailures === 4,
      "Go Live applied with lost response",
    );
    await until(/text="Pause"[^>]*clickable="true"/);
    await observed(
      () => observations.negotiations.length > beforeGoLive,
      "lost Go Live response recovers delivery",
    );
    await observed(
      () => observations.events.length > eventsBeforeGoLive,
      "actual playback after lost Go Live response",
    );
    assert.equal(observations.descriptors.at(-1).paused, false);
    await observed(
      () =>
        observations.descriptors.at(-1)?.playback.entry.endMs - Date.now() >
        25000,
      "enough episode time for caption outage",
      135000,
    );
    const captionEntry = observations.descriptors.at(-1).playback.entry.id,
      eventsBeforeCaption = observations.events.length;
    await chooseCaptions(1);
    await until(/Subtitles unavailable/);
    await observed(
      () => observations.events.length > eventsBeforeCaption,
      "subtitle failure leaves actual video advancing",
    );
    assert.equal(observations.captionFailures, 1);
    assert.equal(
      observations.descriptors.at(-1).playback.entry.id,
      captionEntry,
      "caption failure must not rely on interval transition for recovery",
    );
    // Open the menu while A is stable, then choose just before its boundary.
    // Navigation/UI dumps take time; selecting from a menu spanning the boundary must now be rejected.
    await clickLabel("Subtitles");
    await until(/Synthetic delayed captions/);
    await focusLabel("Synthetic delayed captions");
    await observed(
      () => {
        const remaining =
          observations.descriptors.at(-1)?.playback.entry.endMs - Date.now();
        return remaining > 3000 && remaining < 6500;
      },
      "approaching real episode transition with menu already open",
      135000,
    );
    holdCaption = true;
    await key(23);
    await observed(
      () => heldCaption !== null,
      "held old-episode subtitle request",
    );
    const oldCaptionEntry = observations.descriptors.at(-1).playback.entry.id;
    await observed(
      () =>
        observations.descriptors.at(-1)?.playback.entry.id !== oldCaptionEntry,
      "real next episode",
      15000,
    );
    await chooseCaptions(2);
    await until(/Current episode caption/);
    assert.equal(
      heldCaption.response.destroyed,
      false,
      "old subtitle request must still be pending when the new cues load",
    );
    console.log(
      `Old caption body remained pending for ${Date.now() - heldCaption.startedMs}ms while current cues loaded`,
    );
    heldCaption.release();
    await delay(700);
    xml = await tree();
    assert.match(xml, /Current episode caption/);
    assert.doesNotMatch(xml, /Old episode caption/);
    await capture("08-current-captions");
    // Hold an actual A metadata response, then poll an unavailable interval while an A track menu remains open.
    holdMedia = true;
    await key(21);
    await until(/text="Audio"[^>]*focused="true"/);
    await key(23);
    await until(/Default audio/);
    await key(23);
    await observed(() => heldMedia !== null, "held delivery metadata");
    await key(23);
    await until(/Default audio/);
    const availabilityEntry = observations.descriptors.at(-1).playback.entry.id;
    forceUnavailable = true;
    await observed(
      () => observations.descriptors.at(-1)?.available === false,
      "unavailable interval while menu open",
    );
    const staleMenuNegotiations = observations.negotiations.length;
    await key(23);
    await delay(400);
    assert.equal(
      observations.negotiations.length,
      staleMenuNegotiations,
      "stale open track menu must not request another delivery",
    );
    heldMedia();
    await delay(900);
    await until(/This scheduled video is unavailable/);
    assert.equal(
      observations.negotiations.length,
      staleMenuNegotiations,
      "late A response must not revive unavailable playback",
    );
    assert.equal(
      observations.descriptors.at(-1).playback.entry.id,
      availabilityEntry,
      "availability loss must keep the same episode identity",
    );
  } else {
    const joinedEntry = observations.descriptors.at(-1).playback.entry.id;
    forceUnavailable = true;
    await until(/This scheduled video is unavailable/);
    assert.equal(
      observations.descriptors.at(-1).playback.entry.id,
      joinedEntry,
      "availability loss retains the same interval",
    );
  }
  const availabilityEntry = observations.descriptors.at(-1).playback.entry.id;
  const beforeRestoreEvents = observations.events.length;
  forceUnavailable = false;
  await until(/content-desc="Video playing"/);
  await observed(
    () => observations.events.length > beforeRestoreEvents,
    "same-entry source recovery advances without Retry",
  );
  assert.equal(
    observations.descriptors.at(-1).playback.entry.id,
    availabilityEntry,
    "recovery must not depend on an episode boundary",
  );
  await capture("09-delivery-recovery");
  await key(21, 21, 21, 21, 21, 21);
  await until(/text="Pause"[^>]*focused="true"/);
  await key(23);
  await observed(
    () => observations.descriptors.at(-1)?.paused === true,
    "intentional pause before availability changes",
  );
  const availabilityPausedNegotiations = observations.negotiations.length;
  forceUnavailable = true;
  await until(/This scheduled video is unavailable/);
  forceUnavailable = false;
  await observed(
    () =>
      observations.descriptors.at(-1)?.available &&
      observations.descriptors.at(-1)?.paused,
    "available source preserves intentional pause",
  );
  await until(/text="Resume"/);
  assert.equal(
    observations.negotiations.length,
    availabilityPausedNegotiations,
    "source return must not unpause or negotiate paused delivery",
  );
  await key(4, 4);
  await until(/On your channels/);
  forceUnavailable = true;
  const beforeUnavailableJoin = observations.negotiations.length;
  await key(23);
  await until(/This scheduled video is unavailable/);
  assert.equal(
    observations.negotiations.length,
    beforeUnavailableJoin,
    "initially unavailable join starts no delivery",
  );
  const unavailableEntry = observations.descriptors.at(-1).playback.entry.id;
  const initiallyUnavailableEvents = observations.events.length;
  forceUnavailable = false;
  await observed(
    () => observations.negotiations.length > beforeUnavailableJoin,
    "initially unavailable join automatically negotiates after source return",
  );
  await observed(
    () => observations.events.length > initiallyUnavailableEvents,
    "initially unavailable join resumes actual delivery",
  );
  await until(/content-desc="Video playing"/);
  assert.equal(
    observations.descriptors.at(-1).playback.entry.id,
    unavailableEntry,
    "initially unavailable join recovers the same interval",
  );
  await key(4, 4);
  await until(/On your channels/);
  await shell("am", "force-stop", "tv.mytuner.app");
  // Let the emulator launcher finish foregrounding before the cold launch.
  await delay(1500);
  await shell("am", "start", "-W", "-n", "tv.mytuner.app/.MainActivity");
  await until(/Living Room.*PIN protected/);
  await key(23);
  await until(/Unlock Living Room/);
  await key(8, 9, 10, 11, 66);
  await until(/On your channels/);
  const crashes = await shell("logcat", "-d", "-s", "AndroidRuntime");
  assert.doesNotMatch(crashes, /FATAL EXCEPTION.*|Process: tv\.mytuner\.app/);
  await writeFile(
    "test-results/tv/result.json",
    JSON.stringify(
      {
        passed: true,
        device: serial,
        mode: availabilityOnly ? "availability" : "full",
        steps: availabilityOnly
          ? [
              "launch, connect, browser-approved pairing and profile PIN",
              "failed initial join and remote Retry",
              "same-entry source loss stops delivery",
              "same-entry source return automatically resumes actual delivery",
              "source return preserves intentional pause",
              "initially unavailable join starts no delivery then automatically recovers",
              "cold launch requires numeric remote PIN",
            ]
          : [
              "launch",
              "connect",
              "browser-approved pairing",
              "profiles",
              "PIN",
              "guide",
              "initial join failure and remote Retry",
              "same-entry poll outage automatically resumes actual playback",
              "same-entry source loss/return automatically resumes without Retry",
              "availability recovery preserves intentional pause",
              "initially unavailable join automatically recovers",
              "rejected Pause reconciles and resumes within the same entry",
              "lost successful Pause response preserves intentional pause",
              "playback",
              "pause",
              "paused browse and caption-style/diagnostic dialogs retain the playback session",
              "R10 profile-screen Retry serializes held selection/startup requests",
              "R10 paused captions survive poll recovery, Retry and audio change without delivery",
              "rejected Resume preserves authoritative pause",
              "lost successful Go Live response resumes actual playback",
              "poll outage preserves intentional pause",
              "resume",
              "Go Live",
              "subtitle outage leaves same-entry playback advancing",
              "late old-episode captions cannot replace current same-index cues",
              "stale open track menu cannot reload delivery after interval change",
              "held delivery completion cannot revive unavailable interval",
              "Back to guide",
              "cold launch requires PIN",
            ],
        recovery: {
          joinFailures: observations.joinFailures,
          pollFailures: observations.pollFailures,
          controlFailures: observations.controlFailures,
          deliveredIntervals: observations.events.length,
          captionFailures: observations.captionFailures,
          captionRequests: observations.captionRequests,
        },
        hardware: false,
        visualChecks,
      },
      null,
      2,
    ),
  );
  console.log("TV emulator smoke passed. Screenshots: test-results/tv/");
} catch (error) {
  if (
    error !== visualFinished &&
    error !== tracksFinished &&
    error !== accessibilityFinished
  )
    throw error;
  if (error === accessibilityFinished) {
    /* Dedicated accessibility evidence is written separately. */
  } else if (error === tracksFinished) {
    /* Dedicated tracks evidence is written separately. */
  } else {
    await writeFile(
      "test-results/tv/visual-result.json",
      JSON.stringify({ hardware: false, visualChecks }, null, 2),
    );
    console.log(
      "Native visual subset passed; playback was not exercised in this mode.",
    );
  }
} finally {
  await browser.close();
  proxy.closeAllConnections();
  await new Promise((resolve) => proxy.close(resolve));
}
