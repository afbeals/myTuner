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
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout;
}
async function key(...keys) {
  for (const k of keys) await shell("input", "keyevent", String(k));
  await delay(150);
}
async function tree() {
  await shell("uiautomator", "dump", "/sdcard/mytuner-r7.xml");
  return (
    await run(
      adb,
      ["-s", serial, "exec-out", "cat", "/sdcard/mytuner-r7.xml"],
      { timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
    )
  ).stdout;
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
      x: b ? (+b[1] + +b[3]) / 2 : 0,
      y: b ? (+b[2] + +b[4]) / 2 : 0,
    };
  });
}
async function focus(text) {
  for (let i = 0; i < 16; i++) {
    const rows = nodes(await tree()),
      target = rows.find((n) => n.text === text),
      current = rows.find((n) => n.focused);
    assert.ok(target, `Missing remote target ${text}`);
    if (current?.text === text || target.selected) return;
    if (!current) {
      await key(20);
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
    { encoding: "buffer", timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
  );
  await writeFile(`test-results/tv-r7/${name}.png`, stdout);
}
let holdSelection = false,
  heldSelection = null,
  failSelection = false,
  selects = 0,
  negotiations = 0,
  controls = 0,
  joins = 0,
  reportSends = 0,
  loseReport = true,
  lastSession = null,
  lifecycleRecent = false;
const proxy = createServer((incoming, outgoing) => {
  const path = incoming.url ?? "/";
  const selecting =
    incoming.method === "POST" && /\/profiles\/[^/]+\/select$/.test(path);
  if (selecting) selects++;
  if (incoming.method === "POST" && path.endsWith("/negotiate")) negotiations++;
  if (incoming.method === "POST" && /\/(pause|resume|goLive)$/.test(path))
    controls++;
  if (incoming.method === "POST" && path === "/api/playback/sessions") joins++;
  const reporting =
    incoming.method === "POST" && path === "/api/problem-reports";
  if (reporting) reportSends++;
  const upstream = request(
    new URL(path, base),
    {
      method: incoming.method,
      headers: { ...incoming.headers, host: new URL(base).host },
    },
    (response) => {
      const descriptor =
        (incoming.method === "GET" &&
          /^\/api\/playback\/sessions\/[^/]+$/.test(path)) ||
        (incoming.method === "POST" &&
          (path === "/api/playback/sessions" ||
            /\/(pause|resume|goLive)$/.test(path)));
      const recent =
        lifecycleRecent && incoming.method === "GET" && /\/recent$/.test(path);
      if ((selecting && holdSelection) || reporting || descriptor || recent) {
        let data = "";
        response.on("data", (b) => (data += b));
        response.on("end", () => {
          if (descriptor && response.statusCode < 300)
            lastSession = JSON.parse(data);
          if (recent && response.statusCode === 200)
            data = JSON.stringify({
              items: [
                {
                  title: "Protected synthetic retained title",
                  seasonNumber: 1,
                  episodeNumber: 2,
                  startMs: Date.now() - 120000,
                  endMs: Date.now() - 60000,
                },
              ],
              truncated: false,
            });
          const send = () => {
            if (selecting && failSelection) {
              failSelection = false;
              outgoing.writeHead(503, { "content-type": "application/json" });
              outgoing.end(
                JSON.stringify({
                  error: "Synthetic profile-selection failure",
                }),
              );
            } else if (reporting && loseReport && response.statusCode < 300) {
              loseReport = false;
              outgoing.writeHead(503, { "content-type": "application/json" });
              outgoing.end(
                JSON.stringify({ error: "Synthetic lost report response" }),
              );
            } else {
              const headers = { ...response.headers };
              delete headers["transfer-encoding"];
              headers["content-length"] = String(Buffer.byteLength(data));
              outgoing.writeHead(response.statusCode, headers);
              outgoing.end(data);
            }
          };
          if (selecting && holdSelection) heldSelection = send;
          else send();
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
  incoming.pipe(upstream);
});
await new Promise((r, j) => {
  proxy.once("error", j);
  proxy.listen(8789, "127.0.0.1", r);
});
const browser = await chromium.launch(),
  page = await browser.newPage();
try {
  await mkdir("test-results/tv-r7", { recursive: true });
  await page.goto(base);
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation").waitFor();
  const p = await page.evaluate(async () =>
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
    if (!r.ok) throw Error("Set test PIN failed");
  }, p);
  await shell("pm", "clear", "tv.mytuner.app");
  await shell("am", "start", "-W", "-n", "tv.mytuner.app/.MainActivity");
  await until(/Where is your myTuner server/);
  await key(123, ...Array(7).fill(67));
  await shell("input", "text", "http://10.0.2.2:8789");
  const ime = await shell("dumpsys", "input_method");
  if (/mInputShown=true|isInputViewShown=true|mIsInputViewShown=true/.test(ime))
    await key(4);
  await key(20, 23);
  const xml = await until(/[A-F0-9]{5} [A-F0-9]{5}/),
    code = xml.match(/text="([A-F0-9]{5} [A-F0-9]{5})"/)[1];
  await page.goto(`${base}/#connect-tv`);
  await page.getByLabel("TV connection code").fill(code);
  await page.getByRole("button", { name: "Approve TV", exact: true }).click();
  await until(/Living Room.*PIN protected/);
  // First choice owns the pending request, including failures and opposite-PIN clicks.
  holdSelection = true;
  failSelection = true;
  await key(23);
  await until(/Opening Living Room/);
  await key(22, 23);
  assert.equal(selects, 1);
  await until(/Who’s watching/);
  assert.ok(heldSelection);
  holdSelection = false;
  heldSelection();
  heldSelection = null;
  await until(/Profile was not opened/);
  await capture("01-profile-retry");
  await key(21, 23);
  await until(/Unlock Living Room/);
  assert.equal(selects, 2);
  await key(4);
  await until(/Who’s watching/);
  holdSelection = true;
  await key(22, 23);
  await until(/Opening Other Profile/);
  await key(21, 23);
  assert.equal(selects, 3);
  assert.ok(heldSelection);
  holdSelection = false;
  heldSelection();
  heldSelection = null;
  await until(/On your channels/);
  await until(/Your guide is empty|No channels|empty|Subscribe/i);
  await capture("02-unprotected-guide");
  await key(4);
  await until(/Who’s watching/);
  await key(23);
  await until(/Unlock Living Room/);
  await key(8, 9, 10, 11, 66);
  await until(/On your channels/);
  await key(23);
  await until(/content-desc="Video playing"/);
  await click("Pause");
  await until(/text="Resume"/);
  await delay(700);
  const before = {
    id: lastSession.id,
    revisionId: lastSession.revisionId,
    positionMs: lastSession.positionMs,
    negotiations,
    controls,
    joins,
  };
  await click("More options");
  await click("Recently aired");
  await until(/Retained|retained/);
  await capture("03-recent-airings");
  await key(4);
  assert.equal(lastSession.id, before.id);
  assert.equal(lastSession.paused, true);
  await click("More options");
  await click("Report a problem");
  await until(/text="Picture"/);
  await click("Picture");
  await until(/Exact summary to send/);
  await capture("04-report-review");
  await click("Send report");
  await until(/Not sent or delivery unconfirmed/);
  await capture("05-report-retry");
  await click("Retry sending report");
  await until(/Report sent. Reference/);
  await capture("06-report-sent");
  assert.equal(reportSends, 2);
  assert.equal(joins, before.joins);
  assert.equal(controls, before.controls);
  assert.equal(negotiations, before.negotiations);
  assert.equal(lastSession.id, before.id);
  assert.equal(lastSession.positionMs, before.positionMs);
  assert.equal(lastSession.paused, true);
  const inbox = await page.evaluate(
    async () => await (await fetch("/api/admin/problem-reports")).json(),
  );
  assert.equal(inbox.total, 1);
  assert.equal(inbox.items[0].summary.client, "tv");
  assert.equal(inbox.items[0].summary.state, "paused");
  await key(4);
  await until(/text="Resume"/);
  // Activity-owned dialogs must disappear before fresh profile/PIN selection.
  lifecycleRecent = true;
  async function leaveAndReopen(hidden) {
    await key(3);
    await delay(400);
    await shell("am", "start", "-W", "-n", "tv.mytuner.app/.MainActivity");
    const xml = await until(/Who’s watching/);
    assert.ok(!hidden.test(xml), "Protected dialog survived activity stop");
    await key(23);
    await until(/Unlock Living Room/);
  }
  async function unlockAndPause() {
    await key(8, 9, 10, 11, 66);
    await until(/On your channels/);
    await key(23);
    await until(/content-desc="Video playing"/);
    await click("Pause");
    await until(/text="Resume"/);
  }
  await click("More options");
  await click("Recently aired");
  await until(/Protected synthetic retained title/);
  await leaveAndReopen(/Protected synthetic retained title|Recently aired/);
  await capture("07-lifecycle-requires-pin");
  await unlockAndPause();
  await click("More options");
  await click("Report a problem");
  await until(/text="Picture"/);
  await click("Picture");
  await until(/Exact summary to send/);
  await leaveAndReopen(
    /Exact summary to send|Send report|Review problem report/,
  );
  await capture("08-report-lifecycle-requires-pin");
  const crashes = await shell("logcat", "-d", "-s", "AndroidRuntime");
  assert.ok(!crashes.includes("FATAL EXCEPTION"));
  await writeFile(
    "test-results/tv-r7/result.json",
    JSON.stringify(
      {
        status: "passed",
        profileRequests: selects,
        reportSends,
        reportCount: inbox.total,
        playbackUnchanged: true,
        lifecycleDialogsCleared: true,
        scope:
          "Disposable ARM64 TV emulator, synthetic fixture, D-pad only; no physical-device certification",
      },
      null,
      2,
    ),
  );
  console.log(
    "R7 TV passed: serialized opposite-PIN selections, failed selection retry, correct PIN/guide, recent lookup, explicit lost-response report retry, one report, unchanged paused playback, and cleared protected dialogs on relaunch.",
  );
} finally {
  heldSelection?.();
  await browser.close();
  await new Promise((r) => proxy.close(r));
}
