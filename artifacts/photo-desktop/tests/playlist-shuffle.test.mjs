import { test } from "node:test";
import assert from "node:assert/strict";
import { stepShuffle } from "../src/lib/playlist-shuffle.ts";

const random = () => 0;
const ids = ["a", "b", "c", "d"];
const step = (session, current, direction = 1, auto = false, tracks = ids, playlistId = 1) =>
  stepShuffle(session, playlistId, tracks, current, direction, auto, random);

test("randomizes without mutating saved order and visits every track once", () => {
  let session = null;
  let current = null;
  const played = [];
  for (let i = 0; i < ids.length; i++) {
    const result = step(session, current, 1, true);
    session = result.session;
    current = result.trackId;
    played.push(current);
  }
  assert.deepEqual([...played].sort(), ids);
  assert.notDeepEqual(played, ids);
  assert.deepEqual(ids, ["a", "b", "c", "d"]);
  assert.equal(step(session, current, 1, true).trackId, null);
});

test("enabling shuffle during playback excludes current track from next", () => {
  const result = step(null, "a");
  assert.notEqual(result.trackId, "a");
  assert.equal(result.session.order[0], "a");
});

test("Previous retraces playback history and Next returns along that history", () => {
  const first = step(null, "a");
  const second = step(first.session, first.trackId);
  const previous = step(second.session, second.trackId, -1);
  assert.equal(previous.trackId, first.trackId);
  assert.equal(step(previous.session, previous.trackId).trackId, second.trackId);
});

test("Previous without earlier history restarts current track", () => {
  assert.equal(step(null, "b", -1).trackId, "b");
});

test("manual Next starts a new pass without immediate repeat", () => {
  let result = step(null, "a");
  for (let i = 0; i < ids.length - 2; i++) result = step(result.session, result.trackId);
  const last = result.trackId;
  assert.equal(step(result.session, last, 1, true).trackId, null);
  const next = step(result.session, last);
  assert.notEqual(next.trackId, last);
});

test("empty and single-track playlists are safe", () => {
  assert.deepEqual(step(null, null, 1, false, []), { session: null, trackId: null });
  const first = step(null, null, 1, false, ["a"]);
  assert.equal(first.trackId, "a");
  assert.equal(step(first.session, "a", 1, true, ["a"]).trackId, null);
  assert.equal(step(first.session, "a", 1, false, ["a"]).trackId, "a");
});

test("removed tracks disappear and added tracks join the queue", () => {
  const first = step(null, "a");
  const changed = ids.filter(id => id !== "b").concat("e");
  const result = step(first.session, first.trackId, 1, false, changed);
  assert.equal(result.session.order.includes("b"), false);
  assert.equal(result.session.order.includes("e"), true);
  assert.equal(new Set(result.session.order).size, changed.length);
});

test("switching playlists or manually choosing another track resets the queue", () => {
  const first = step(null, "a");
  const manual = step(first.session, "d");
  assert.equal(manual.session.order[0], "d");
  assert.notEqual(manual.trackId, "d");
  const other = step(first.session, null, 1, false, ["x", "y"], 2);
  assert.equal(other.session.playlistId, 2);
  assert.deepEqual([...other.session.order].sort(), ["x", "y"]);
});
