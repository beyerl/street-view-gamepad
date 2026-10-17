import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE, KeyMappingSession } from "../../src/application/key-mapping.js";
import { ACTIONS, defaultButtonMap, presetButtonMap } from "../../src/domain/actions.js";
import { flush, pad, spy } from "../helpers/fakes.js";

function setup() {
  const saved = [];
  const onChange = spy();
  const s = new KeyMappingSession({ save: async (m) => saved.push({ ...m }), onChange });
  return { s, saved, onChange };
}

test("starts idle with the defaults; loading keeps defaults for actions not stored", () => {
  const { s, onChange } = setup();
  assert.equal(s.step, IDLE);
  assert.equal(s.configuring, false);
  assert.equal(s.preset, "xbox");
  s.load({ forward: 7, mode1: 12 });
  assert.equal(s.map.forward, 7);
  assert.equal(s.map.back, 0);
  assert.equal(s.preset, null);
  assert.equal(onChange.calls.length, 1);
});

test("configure all walks through the actions; one press isn't taken twice", async () => {
  const { s, saved } = setup();
  s.begin(0, false);
  s.poll([pad([10])]); // still held from before: not armed yet
  s.poll([pad([])]);
  s.poll([pad([10])]);
  await flush();
  assert.equal(saved.at(-1).forward, 10);
  assert.equal(s.step, 1);
  s.poll([pad([10])]); // the same press
  assert.equal(saved.length, 1);
  s.poll([pad([])]);
  s.poll([pad([11])]);
  await flush();
  assert.equal(saved.at(-1).back, 11);
});

test("an input taken by another action is unassigned from it; axes work like buttons", async () => {
  const { s, saved } = setup();
  s.load({ back: "a1+", lookDown: null, mode1: 12 });
  s.begin(0, true);
  s.poll([pad([], [0, 0])]);
  s.poll([pad([], [0, 1])]);
  await flush();
  assert.equal(saved.at(-1).forward, "a1+");
  assert.equal(saved.at(-1).back, null);
  assert.equal(s.step, IDLE); // single: done
});

test("skip, end at the last action, cancel and apply a preset", async () => {
  const { s, saved } = setup();
  s.begin(ACTIONS.length - 2, false);
  s.advance();
  assert.equal(s.step, ACTIONS.length - 1);
  s.advance();
  assert.equal(s.step, IDLE);
  s.begin(3, false);
  s.end();
  assert.equal(s.step, IDLE);
  s.load({ forward: 9, mode1: 12 });
  s.begin(3, false);
  await s.applyPreset("snes");
  assert.equal(s.step, IDLE);
  assert.deepEqual(saved.at(-1), presetButtonMap("snes"));
  assert.equal(s.preset, "snes");
  await s.applyPreset("xbox");
  assert.deepEqual(saved.at(-1), defaultButtonMap());
  s.poll([pad([1])]); // idle: ignored
  assert.equal(saved.length, 2);
});

test("rest positions are taken anew when configuring starts", async () => {
  const { s, saved } = setup();
  s.begin(0, true);
  s.poll([pad([], [0.9])]); // a stick held while clicking start: its rest
  s.poll([pad([], [0.9])]);
  assert.equal(saved.length, 0);
  s.poll([pad([], [-0.2])]);
  await flush();
  assert.equal(saved.at(-1).forward, "a0-");
});
