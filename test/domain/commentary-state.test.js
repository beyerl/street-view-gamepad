import { test } from "node:test";
import assert from "node:assert/strict";
import { Paused, Playing, PlaybackStatus, Stopped } from "../../src/domain/commentary-state.js";

const A = { id: "en:1", title: "A" };
const B = { id: "en:2", title: "B" };

function ctx(nearby = {}) {
  const calls = [];
  return {
    calls,
    nearbyFor: (tab) => nearby[tab] || null,
    start: async (tab, a) => calls.push(["start", tab, a.id]),
    pauseCurrent: async () => calls.push(["pause"]),
    resume: async () => calls.push(["resume"]),
  };
}

test("stopped: the button starts the article nearby, if any", async () => {
  const c = ctx({ 5: A });
  await new Stopped().toggle(c, 5);
  await new Stopped().toggle(c, 6);
  assert.deepEqual(c.calls, [["start", 5, "en:1"]]);
  assert.equal(new Stopped().status, PlaybackStatus.STOPPED);
  await new Stopped().pause(c, 5);
  assert.equal(c.calls.length, 1);
});

test("playing: the button pauses, whichever tab asks; pause() honours the tab", async () => {
  const c = ctx();
  const s = new Playing(5, A);
  await s.toggle(c, 9);
  await s.pause(c, 9);
  await s.pause(c, 5);
  await s.pause(c);
  assert.deepEqual(c.calls, [["pause"], ["pause"], ["pause"]]);
  assert.equal(s.status, PlaybackStatus.PLAYING);
  assert.equal(s.belongsTo(5), true);
});

test("paused: resumes if still nearby or nothing else is; otherwise starts the new article", async () => {
  const same = ctx({ 5: A });
  await new Paused(5, A).toggle(same, 5);
  const none = ctx();
  await new Paused(5, A).toggle(none, 5);
  const moved = ctx({ 5: B });
  await new Paused(5, A).toggle(moved, 5);
  const otherTab = ctx({ 6: A });
  await new Paused(5, A).toggle(otherTab, 6);
  const nothing = ctx();
  await new Paused(5, A).toggle(nothing, 6);
  assert.deepEqual(same.calls, [["resume"]]);
  assert.deepEqual(none.calls, [["resume"]]);
  assert.deepEqual(moved.calls, [["start", 5, "en:2"]]);
  assert.deepEqual(otherTab.calls, [["start", 6, "en:1"]]);
  assert.deepEqual(nothing.calls, []);
});
