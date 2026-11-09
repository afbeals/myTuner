import test from "node:test";
import assert from "node:assert/strict";
import { eventId, parseVtt } from "../web/src/playback-utils.js";
test("LAN-safe playback IDs and source-time subtitle cues", () => {
  assert.match(
    eventId(),
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
  );
  assert.notEqual(eventId(), eventId());
  assert.deepEqual(
    parseVtt(
      "WEBVTT\r\n\r\n1\r\n00:01:30.250 --> 00:01:32.500 align:center\r\nHello <i>world</i>\r\n\r\nNOTE ignored\r\n",
    ),
    [{ start: 90250, end: 92500, text: "Hello world" }],
  );
  assert.deepEqual(
    parseVtt("WEBVTT\n\n00:02.000 --> 00:01.000\ninvalid\n"),
    [],
  );
});
