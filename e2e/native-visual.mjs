import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir } from "node:fs/promises";
const execute = promisify(execFile);
export async function nativeVisual(
  name,
  actual,
  { update = false, variant = name, region } = {},
) {
  const directory = "e2e/tv-baselines/android-tv-api34-arm64";
  await mkdir(directory, { recursive: true });
  const normalized = `test-results/tv/${name}-normalized.png`;
  // Mask clocks and the dynamic live/behind-live strip; crop controls/dialogs
  // clear of moving video. UI/error/cue assertions use unmodified captures.
  const masks = ["drawbox=x=1670:y=56:w=154:h=83:color=0x22333b:t=fill"];
  if (name === "05-guide")
    masks.push(
      "drawbox=x=390:y=484:w=350:h=46:color=0x77f5de:t=fill",
      "drawbox=x=820:y=484:w=350:h=46:color=0x24363f:t=fill",
    );
  if (["06-playing", "07-paused"].includes(name)) {
    masks.splice(0, masks.length);
    if (name === "06-playing")
      masks.push("drawbox=x=128:y=650:w=1300:h=50:color=0x192830:t=fill");
    masks.push("crop=1728:526:96:498");
  }
  if (name === "06-join-error") masks.splice(0, masks.length);
  if (name === "07-caption-style")
    masks.splice(0, masks.length, "crop=992:870:464:105");
  if (name === "07-browse-paused")
    masks.splice(0, masks.length, "crop=992:519:464:280");
  if (region) {
    const { x, y, width, height } = region;
    assert.ok(
      [x, y, width, height].every(Number.isInteger) &&
        x >= 0 &&
        y >= 0 &&
        width > 0 &&
        height > 0,
    );
    masks.splice(0, masks.length, `crop=${width}:${height}:${x}:${y}`);
  }
  await execute(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      actual,
      "-vf",
      [...masks, "scale=960:540"].join(","),
      "-frames:v",
      "1",
      normalized,
    ],
    { timeout: 15000 },
  );
  const baseline = `${directory}/${variant}.png`;
  if (update) {
    await copyFile(normalized, baseline);
    return { name, status: "updated" };
  }
  async function pixels(path) {
    return (
      await execute(
        "ffmpeg",
        [
          "-v",
          "error",
          "-i",
          path,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { encoding: "buffer", timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
      )
    ).stdout;
  }
  const [received, expected] = await Promise.all([
    pixels(normalized),
    pixels(baseline),
  ]);
  assert.equal(received.length, 960 * 540 * 3);
  assert.equal(expected.length, received.length);
  let changed = 0;
  for (let i = 0; i < received.length; i += 3)
    if ([0, 1, 2].some((j) => Math.abs(received[i + j] - expected[i + j]) > 20))
      changed++;
  const changedRatio = changed / (960 * 540);
  assert.ok(
    changedRatio <= 0.005,
    `${name}: native visual difference ${(changedRatio * 100).toFixed(2)}%; review ${normalized} against ${baseline}`,
  );
  return { name, status: "passed", changedRatio };
}
