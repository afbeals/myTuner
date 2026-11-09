import test from "node:test";
import assert from "node:assert/strict";
import { parseRange } from "../src/ranges.js";
test("byte ranges support full, open-ended, suffix, and clipped bounds", () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=90-1000", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-200", 100), { start: 0, end: 99 });
});
for (const value of [
  "bytes=100-",
  "bytes=20-10",
  "bytes=-0",
  "bytes=-",
  "bytes=0-1,4-5",
  "items=0-1",
  "bytes=9007199254740992-",
  "garbage",
])
  test(`invalid range rejected: ${value}`, () =>
    assert.equal(parseRange(value, 100), "invalid"));
