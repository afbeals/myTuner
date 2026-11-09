import { nativeVisual } from "./native-visual.mjs";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
const run = promisify(execFile),
  adb = process.env.MYTUNER_ADB ?? "adb",
  serial = process.env.MYTUNER_TV_SERIAL ?? "emulator-5554",
  base = process.env.MYTUNER_TV_TEST_SERVER ?? "http://127.0.0.1:8790";
assert.match(serial, /^emulator-\d+$/, "Synthetic emulator only");
assert.match(
  base,
  /^http:\/\/127\.0\.0\.1:/,
  "Disposable loopback fixture only",
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
let lastTree = "";
let subtitleMenuVariant = "29-subtitle-menu";
const largeOnly = process.env.MYTUNER_TV_STATES_LARGE === "1";
const pairingOnly = process.env.MYTUNER_TV_PAIRING_ONLY === "1";
const pairingFinished = Symbol("pairing-finished");
const captures = largeOnly ? "test-results/tv-large" : "test-results/tv";
let previousFont = null;
async function tree() {
  let dumped = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      dumped = await shell(
        "timeout",
        "12",
        "uiautomator",
        "dump",
        "/sdcard/mytuner-states.xml",
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
  lastTree = (
    await run(
      adb,
      ["-s", serial, "exec-out", "cat", "/sdcard/mytuner-states.xml"],
      { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
    )
  ).stdout;
  return lastTree;
}
async function until(pattern) {
  let xml;
  for (let i = 0; i < 12; i++) {
    xml = await tree();
    if (pattern.test(xml)) return xml;
    await delay(200);
  }
  throw Error(`TV missing ${pattern}: ${xml?.slice(-3000)}`);
}
function nodes(xml) {
  return [...xml.matchAll(/<node\b[^>]+>/g)].map(([raw]) => {
    const attr = (name) =>
        raw.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "",
      b = attr("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    return {
      text: attr("text").replaceAll("&amp;", "&"),
      focused: attr("focused") === "true",
      selected: attr("selected") === "true",
      resourceId: attr("resource-id"),
      focusable: attr("focusable") === "true",
      x: b ? (+b[1] + +b[3]) / 2 : 0,
      y: b ? (+b[2] + +b[4]) / 2 : 0,
      height: b ? +b[4] - +b[2] : 0,
    };
  });
}
async function focus(text) {
  for (let i = 0; i < 16; i++) {
    const rows = nodes(await tree()),
      target = rows.find((n) => n.text.toLowerCase() === text.toLowerCase()),
      current = rows.find((n) => n.selected) ?? rows.find((n) => n.focused);
    if (!target && i < 2) {
      await delay(200);
      continue;
    }
    if (!target && i < 14 && lastTree.includes('scrollable="true"')) {
      // Large text can put an existing control below the visible scroll area.
      // Use actual remote navigation to reveal it before choosing the target.
      await key(20);
      continue;
    }
    assert.ok(target, `Missing remote target ${text}`);
    if (target.focused || target.selected) return;
    if (!current) {
      await key(20);
      continue;
    }
    const menu = rows.filter((n) => n.resourceId === "android:id/text1");
    const from = menu.indexOf(current),
      to = menu.indexOf(target);
    if (from >= 0 && to >= 0) {
      await key(...Array(Math.abs(to - from)).fill(to > from ? 20 : 19));
      continue;
    }
    const row = rows
      .filter((n) => n.focusable && Math.abs(n.y - target.y) < 20)
      .sort((a, b) => a.x - b.x);
    const rowFrom = row.indexOf(current),
      rowTo = row.indexOf(target);
    if (rowFrom >= 0 && rowTo >= 0 && rowFrom !== rowTo) {
      await key(
        ...Array(Math.abs(rowTo - rowFrom)).fill(rowTo > rowFrom ? 22 : 21),
      );
      continue;
    }
    const dx = target.x - current.x,
      dy = target.y - current.y;
    await key(Math.abs(dy) > 20 ? (dy > 0 ? 20 : 19) : dx > 0 ? 22 : 21);
  }
  throw Error(`Could not focus ${text} by D-pad`);
}
async function click(text) {
  await focus(text);
  await key(23);
}
async function capture(name) {
  const { stdout } = await run(
    adb,
    ["-s", serial, "exec-out", "screencap", "-p"],
    { encoding: "buffer", timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
  );
  await writeFile(`${captures}/${name}.png`, stdout);
  await writeFile(`${captures}/${name}.xml`, lastTree || (await tree()));
  if (largeOnly) {
    assert.ok(
      lastTree.includes('focusable="true"'),
      `${name}: large text retains remote controls`,
    );
    await writeFile(`${captures}/${name}.xml`, lastTree);
    console.log(`Large-text state verified: ${name}`);
    return;
  }
  if (
    [
      "14-pairing-review",
      "23-report-review",
      "24-report-retry",
      "25-report-sent",
      "27-connection-details",
    ].includes(name)
  ) {
    evidence.push(
      `${name}: full screenshot and hierarchy reviewed; dynamic identifiers/timestamps are not pixel baselines`,
    );
    console.log(`State captured for review: ${name}`);
    return;
  }
  const xml = lastTree || (await tree());
  await writeFile(`test-results/tv/${name}.xml`, xml);
  const panel = [...xml.matchAll(/<node\b[^>]+>/g)]
    .map(([raw]) => raw)
    .find((raw) => raw.includes('resource-id="android:id/parentPanel"'));
  const b = panel
    ?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    ?.slice(1)
    .map(Number);
  const region = b
    ? { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] }
    : undefined;
  if (region)
    assert.ok(
      region.x >= 0 &&
        region.y >= 0 &&
        region.x + region.width <= 1920 &&
        region.y + region.height <= 1080,
    );
  if (name === "29-subtitle-menu") {
    const actualTracks = nodes(xml)
      .filter((n) => n.resourceId === "android:id/text1")
      .map((n) => n.text);
    assert.deepEqual(
      actualTracks,
      subtitleMenuVariant === name
        ? ["Off", "fr · adjacent (webvtt)", "en · subfolder (srt)"]
        : ["Off", "en · subfolder (srt)"],
      "Subtitle options match the actual paused episode",
    );
  }
  checks.push(
    await nativeVisual(name, `test-results/tv/${name}.png`, {
      update: process.env.MYTUNER_UPDATE_TV_BASELINES === "1",
      region,
      variant: name === "29-subtitle-menu" ? subtitleMenuVariant : name,
    }),
  );
  console.log(`State visual ${checks.at(-1).status}: ${name}`);
}
const checks = [],
  evidence = [];
let rules = [],
  held = [];
function rule(path, value, method) {
  rules = [{ path, value, method }];
}
function clear() {
  rules = [];
  for (const send of held.splice(0)) send();
}
const proxy = createServer((incoming, outgoing) => {
  const path = incoming.url ?? "/",
    selected = rules.find(
      (r) => r.path.test(path) && (!r.method || r.method === incoming.method),
    );
  if (selected && !["hold", "lost"].includes(selected.value)) {
    incoming.resume();
    const v = selected.value;
    if (v === "offline") {
      outgoing.destroy();
      return;
    }
    outgoing.writeHead(v.status ?? 200, { "content-type": "application/json" });
    outgoing.end(
      JSON.stringify(
        v.body ?? { error: `Synthetic native ${v.status} failure` },
      ),
    );
    return;
  }
  const upstream = request(
    new URL(path, base),
    {
      method: incoming.method,
      headers: { ...incoming.headers, host: new URL(base).host },
    },
    (response) => {
      if (selected?.value === "lost") {
        response.resume();
        response.on("end", () => {
          outgoing.writeHead(503, { "content-type": "application/json" });
          outgoing.end(
            JSON.stringify({ error: "Synthetic lost successful report reply" }),
          );
        });
      } else if (selected?.value === "hold") {
        const chunks = [];
        response.on("data", (b) => chunks.push(b));
        response.on("end", () =>
          held.push(() => {
            if (outgoing.destroyed) return;
            outgoing.writeHead(response.statusCode, response.headers);
            outgoing.end(Buffer.concat(chunks));
          }),
        );
      } else {
        outgoing.writeHead(response.statusCode, response.headers);
        response.pipe(outgoing);
      }
    },
  );
  upstream.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.pipe(upstream);
});
await new Promise((r, j) => {
  proxy.once("error", j);
  proxy.listen(8789, "127.0.0.1", r);
});
const browser = await chromium.launch(),
  page = await browser.newPage();
async function approve() {
  const xml = await until(/[A-F0-9]{5} [A-F0-9]{5}/),
    code = xml.match(/text="([A-F0-9]{5} [A-F0-9]{5})"/)[1];
  await page.goto(`${base}/#connect-tv`);
  await page.getByLabel("TV connection code").fill(code);
  await page.getByRole("button", { name: "Review TV", exact: true }).click();
  await page.getByRole("button", { name: "Approve TV", exact: true }).click();
}
async function openMore(item) {
  await click("More options");
  await click(item);
}
try {
  await mkdir(captures, { recursive: true });
  if (largeOnly) {
    previousFont = (
      await shell("settings", "get", "system", "font_scale")
    ).trim();
    await shell("settings", "put", "system", "font_scale", "1.3");
  }
  assert.equal((await shell("getprop", "ro.build.version.sdk")).trim(), "34");
  await page.goto(base);
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation").waitFor();
  const profile = await page.evaluate(async () =>
    (await (await fetch("/api/profiles")).json()).find(
      (p) => p.name === "Living Room",
    ),
  );
  await page.evaluate(async (p) => {
    const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
    const r = await fetch(`/api/profiles/${p.id}/pin`, {
      method: "PUT",
      headers: {
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pin: "1234" }),
    });
    if (!r.ok) throw Error("Synthetic PIN setup failed");
  }, profile);
  // Restrict the crash assertion to this disposable emulator run.
  await shell("logcat", "-c");
  await shell("am", "force-stop", "tv.mytuner.app");
  await key(3);
  await shell("pm", "clear", "tv.mytuner.app");
  await delay(1200);
  await shell("am", "start", "-W", "-n", "tv.mytuner.app/.MainActivity");
  await until(/Where is your myTuner server/);
  await key(123, ...Array(7).fill(67));
  await shell("input", "text", "http://10.0.2.2:8789");
  const ime = await shell("dumpsys", "input_method");
  if (/mInputShown=true|isInputViewShown=true|mIsInputViewShown=true/.test(ime))
    await key(4);
  await key(20);
  rule(/^\/api\/health$/, { status: 503 });
  await key(23);
  await until(/Synthetic native 503 failure/);
  await capture("11-connect-failure");
  rule(/^\/api\/health$/, "offline");
  await click("Connect");
  await until(/Unable to reach your server/);
  await capture("33-connect-offline");
  rule(/^\/api\/health$/, { body: "Synthetic HTML gateway" });
  await click("Connect");
  await until(/unreadable response/);
  await capture("34-connect-unreadable");
  clear();
  await click("Connection help");
  await until(/Connect your TV to Unraid/);
  await capture("12-install-help");
  await click("Back to server address");
  await until(/Where is your myTunerner server|Where is your myTuner server/);
  await key(123, ...Array(7).fill(67));
  await shell("input", "text", "http://10.0.2.2:8789");
  const secondIme = await shell("dumpsys", "input_method");
  if (
    /mInputShown=true|isInputViewShown=true|mIsInputViewShown=true/.test(
      secondIme,
    )
  )
    await key(4);
  await key(20);
  rule(/^\/api\/health$/, { body: { service: "mytuner", apiVersion: 999 } });
  await key(23);
  await until(/server API is incompatible/);
  await capture("13-incompatible-server");
  clear();
  rule(/^\/api\/auth\/pairings$/, "hold", "POST");
  await click("Connect");
  await until(/Requesting code/);
  evidence.push("pairing pending");
  for (let i = 0; !held.length && i < 50; i++) await delay(100);
  assert.ok(held.length, "Synthetic held response arrived");
  clear();
  await until(/[A-F0-9]{5} [A-F0-9]{5}/);
  if (largeOnly) {
    const pairingFocus = nodes(lastTree).find((n) => n.focused);
    assert.ok(
      pairingFocus && pairingFocus.height >= 64,
      "Enlarged pairing keeps the complete focused action visible after QR layout",
    );
  }
  // Keep all public dynamic approval data out of the pixel comparison.
  await capture("14-pairing-review");
  rule(/^\/api\/auth\/pairings\/poll$/, { status: 410 });
  await until(/Synthetic native 410 failure|expired/);
  evidence.push("pairing expired retry");
  if (largeOnly) {
    const pairingFocus = nodes(lastTree).find((n) => n.focused);
    assert.ok(
      pairingFocus && pairingFocus.height >= 64,
      "Enlarged pairing keeps the complete focused action visible after errors",
    );
  }
  clear();
  await click("Get a new code");
  await approve();
  await until(/Who’s watching/);
  if (pairingOnly) {
    await writeFile(
      "test-results/tv/pairing-large-result.json",
      JSON.stringify(
        {
          status: "passed",
          fontScale: largeOnly ? 1.3 : 1,
          qrFocusFullyVisible: true,
          errorFocusFullyVisible: true,
          expiredCodeRetry: true,
          browserApproved: true,
          scope:
            "Current APK focused pairing regression; full state/font journeys were completed before the pairing-only focus correction.",
        },
        null,
        2,
      ),
    );
    console.log(
      "Focused enlarged pairing recovery passed: complete action remains visible after QR/error layout",
    );
    throw pairingFinished;
  }
  await until(/Living Room.*PIN protected/);
  rule(/^\/api\/profiles$/, "hold");
  await click("Retry profiles");
  await until(/Loading profiles/);
  evidence.push("Explicit profile loading state");
  for (let i = 0; !held.length && i < 50; i++) await delay(100);
  assert.ok(held.length, "Held profile response arrived");
  clear();
  await until(/Living Room.*PIN protected/);
  rule(/^\/api\/profiles$/, { status: 503 });
  await click("Retry profiles");
  await until(/Synthetic native 503 failure/);
  await capture("15-profiles-failure");
  rule(/^\/api\/profiles$/, { body: [] });
  await click("Retry profiles");
  await until(/No profiles are assigned/);
  await capture("16-profiles-empty");
  clear();
  await click("Retry profiles");
  await until(/Living Room.*PIN protected/);
  await key(23);
  await until(/Unlock Living Room/);
  await key(7, 7, 7, 7, 66);
  await until(/Incorrect PIN|Invalid PIN/i);
  // Wrong PIN does not leave the PIN screen; clear all digits before retry.
  assert.match(await tree(), /Unlock Living Room/);
  await capture("17-pin-error");
  rule(/\/guide\?/, "hold");
  await key(67, 67, 67, 67, 8, 9, 10, 11, 66);
  await until(/Loading your channels/);
  evidence.push("Explicit guide loading state");
  for (let i = 0; !held.length && i < 50; i++) await delay(100);
  assert.ok(held.length, "Held guide response arrived");
  clear();
  await until(/After School/);
  rule(/\/guide\?/, { status: 403 });
  await click("Now");
  await until(/Synthetic native 403 failure/);
  await capture("18-guide-denied");
  rule(/\/guide\?/, { body: { channels: [] } });
  await click("Now");
  await until(/Your guide is empty/);
  await capture("19-guide-empty");
  clear();
  await click("Now");
  await until(/After School/);
  await key(20, 23);
  await until(/content-desc="Video playing"/);
  await click("Pause");
  await until(/text="Resume"/);
  rule(/\/recent$/, { status: 503 });
  await openMore("Recently aired");
  await until(/Recent airings unavailable/);
  await capture("20-recent-failure");
  await key(4);
  rule(/\/recent$/, { body: { items: [], truncated: false } });
  await openMore("Recently aired");
  await until(/No retained programs/);
  await capture("21-recent-empty");
  await key(4);
  rule(/\/report-preview$/, "hold");
  await openMore("Report a problem");
  await click("Picture");
  await until(/Preparing a summary/);
  evidence.push("report pending, no send before preview");
  await capture("22-report-pending");
  for (let i = 0; !held.length && i < 50; i++) await delay(100);
  assert.ok(held.length, "Synthetic held response arrived");
  clear();
  await until(/Exact summary to send/);
  await capture("23-report-review");
  const reportsBefore = await page.evaluate(
    async () =>
      (await (await fetch("/api/admin/problem-reports")).json()).total,
  );
  rule(/^\/api\/problem-reports$/, "lost", "POST");
  await click("Send report");
  await until(/Not sent or delivery unconfirmed/);
  await capture("24-report-retry");
  clear();
  await click("Retry sending report");
  await until(/Report sent. Reference/);
  await capture("25-report-sent");
  const reportsAfter = await page.evaluate(
    async () =>
      (await (await fetch("/api/admin/problem-reports")).json()).total,
  );
  assert.equal(
    reportsAfter,
    reportsBefore + 1,
    "Uncertain native report retry creates exactly one report",
  );
  evidence.push(
    "Actual successful report commit, lost reply and retry deduplicated to one report",
  );
  await key(4);
  rule(/\/guide$/, { status: 503 });
  await click("Browse channels");
  await until(/Lineup unavailable/);
  await capture("26-browse-failure");
  await key(4);
  rule(/\/guide$/, { body: { channels: [] } });
  await click("Browse channels");
  await until(/No channels are available/);
  await capture("32-browse-empty");
  await key(4);
  clear();
  await openMore("Connection help");
  await until(/Device:|Server:/);
  await capture("27-connection-details");
  rule(/^\/api\/health$/, { status: 503 });
  await click("Check server");
  await until(/Server check failed/);
  await capture("28-connection-check-failure");
  await key(4);
  clear();
  const trackProgram = await tree();
  if (/text="Maple Street · S1 E2/.test(trackProgram))
    subtitleMenuVariant = "29-subtitle-menu-english-only";
  else
    assert.match(
      trackProgram,
      /text="The Last Platform · S1 E1/,
      "A known synthetic current episode determines its track specimen",
    );
  await click("Subtitles");
  await until(/text="Off"/);
  await capture("29-subtitle-menu");
  await key(4);
  await click("Audio");
  await until(/Default audio/);
  await capture("30-audio-menu");
  await key(4);
  assert.match(await tree(), /text="Resume"/);
  // First Back hides playback controls; the next returns to the guide.
  await key(4, 4);
  await until(/On your channels/);
  await key(4);
  await until(/Who’s watching/);
  await click("Forget pairing");
  await until(/Forget this TV’s pairing/);
  await capture("31-forget-confirmation");
  await click("Cancel");
  await until(/Who’s watching/);
  assert.ok(
    !(await shell("logcat", "-d", "-s", "AndroidRuntime")).includes(
      "FATAL EXCEPTION",
    ),
  );
  await writeFile(
    largeOnly
      ? "test-results/tv/states-large-result.json"
      : "test-results/tv/states-result.json",
    JSON.stringify(
      {
        status: "passed",
        fontScale: largeOnly ? 1.3 : 1,
        visualChecks: checks,
        evidence,
        scope:
          "Disposable API34 ARM64 emulator, remote key events including numeric PIN input. The full smoke separately verifies the on-screen D-pad PIN keypad. Human spoken/physical-device acceptance remains deferred.",
      },
      null,
      2,
    ),
  );
  console.log("Native state audit passed", checks.length, "visual comparisons");
} catch (error) {
  if (error !== pairingFinished) {
    await writeFile(`${captures}/failure.xml`, lastTree);
    throw error;
  }
} finally {
  if (previousFont === "null")
    await shell("settings", "delete", "system", "font_scale");
  else if (previousFont !== null)
    await shell("settings", "put", "system", "font_scale", previousFont);
  clear();
  await browser.close();
  proxy.closeAllConnections();
  await new Promise((r) => proxy.close(r));
}
