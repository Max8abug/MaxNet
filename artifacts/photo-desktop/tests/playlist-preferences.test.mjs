import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readPersonalPlaylistShufflePreference,
  writePersonalPlaylistShufflePreference,
} from "../src/lib/personal-playlist-preferences.ts";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("shuffle preference persists on and off per account without changing playlist order", () => {
  const storage = createStorage();
  assert.equal(readPersonalPlaylistShufflePreference("Alice", storage), false);
  assert.equal(writePersonalPlaylistShufflePreference("Alice", true, storage), true);
  assert.equal(readPersonalPlaylistShufflePreference("alice", storage), true);
  assert.equal(readPersonalPlaylistShufflePreference("Bob", storage), false);
  assert.equal(writePersonalPlaylistShufflePreference("Alice", false, storage), true);
  assert.equal(readPersonalPlaylistShufflePreference("Alice", storage), false);
});

test("storage failures do not crash playlist controls and can be reported to the user", () => {
  const unavailableStorage = {
    getItem: () => { throw new Error("storage unavailable"); },
    setItem: () => { throw new Error("storage unavailable"); },
  };
  assert.equal(readPersonalPlaylistShufflePreference("Alice", unavailableStorage), false);
  assert.equal(writePersonalPlaylistShufflePreference("Alice", true, unavailableStorage), false);
});
