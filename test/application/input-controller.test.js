import { test } from "node:test";
import assert from "node:assert/strict";
import { InputController } from "../../src/application/input-controller.js";
import { Action } from "../../src/domain/actions.js";
import { withDefaults } from "../../src/domain/settings.js";
import { makeClock, pad, spy } from "../helpers/fakes.js";

const B = withDefaults().buttonMap;

function controls(walkPans) {
  const log = [];
  const held = (name) => ({
    down: (repeat) => log.push(`${name} down${repeat ? " repeat" : ""}`),
    up: () => log.push(`${name} up`),
  });
  return {
    log,
    looks: [],
    walkPans,
    held: (name) =>
      [Action.FORWARD, Action.BACK, Action.ZOOM_IN, Action.MINIMAP_ZOOM_IN].includes(name) &&
      !(walkPans && [Action.FORWARD, Action.BACK].includes(name))
        ? held(name)
        : null,
    look(dx, dy, dt) {
      this.looks.push([dx, dy, dt]);
    },
  };
}

function setup({ buttonMap = {}, streetView = true } = {}) {
  const clock = makeClock();
  const state = { pads: [], hidden: false, streetView };
  const sv = controls(false);
  const map = controls(true);
  const jump = { onWalk: spy(), cancel: spy(), checkingBack: false };
  const commands = Object.fromEntries(Object.values(Action).map((a) => [a, spy()]));
  const log = spy();
  const c = new InputController({
    input: { pads: () => state.pads },
    settings: withDefaults({ buttonMap }),
    isHidden: () => state.hidden,
    isStreetView: () => state.streetView,
    streetView: sv,
    map,
    jump,
    commands,
    now: () => clock.now(),
    log,
  });
  const tick = (ms = 16) => {
    clock.tick(ms);
    c.tick();
  };
  return { c, state, sv, map, jump, commands, log, tick, press: (...b) => (state.pads = [pad(b)]) };
}

test("a press action that throws still runs only once per press", () => {
  const env = setup();
  let runs = 0;
  env.commands.mode = () => {
    runs++;
    throw new Error("boom");
  };
  env.press(B.mode);
  assert.throws(() => env.tick());
  env.tick();
  env.tick();
  assert.equal(runs, 1);
});

test("a held action presses on, repeats after a delay, and releases", () => {
  const env = setup();
  env.press(B.forward);
  env.tick();
  env.tick(340);
  assert.deepEqual(env.sv.log, ["forward down"]);
  env.tick(20); // 376 ms: past the 350 ms delay
  env.tick(130);
  env.press();
  env.tick();
  assert.deepEqual(env.sv.log, ["forward down", "forward down repeat", "forward down repeat", "forward up"]);
});

test("press actions run once per press, whatever their binding", () => {
  const env = setup({ buttonMap: { historyBack: "a1-", strafeLeft: 6 } });
  env.press(B.mode);
  env.tick();
  env.tick(500);
  env.press();
  env.tick();
  env.press(B.mode);
  env.tick();
  assert.equal(env.commands.mode.calls.length, 2);
  env.state.pads = [pad([6], [0, -1])];
  env.tick();
  assert.equal(env.commands.historyBack.calls.length, 1);
  assert.equal(env.commands.strafeLeft.calls.length, 1);
  assert.equal(env.commands.articleNext.calls.length, 0); // unassigned
});

test("look actions look in their direction, scaled by time; on the map walking pans", () => {
  const sv = setup();
  sv.press(B.lookRight, B.lookUp);
  sv.tick();
  assert.deepEqual(sv.sv.looks.at(-1), [1, -1, 16]);
  sv.press(B.forward);
  sv.tick(500);
  assert.deepEqual(sv.sv.looks.at(-1), [0, 0, 100]); // clamped after a stall; forward walks, doesn't pan

  const map = setup({ streetView: false });
  map.press(B.forward, B.lookLeft);
  map.tick();
  assert.deepEqual(map.map.looks.at(-1), [-1, -1, 16]);
  map.press(B.back);
  map.tick();
  assert.deepEqual(map.map.looks.at(-1), [0, 1, 16]);
  assert.equal(map.map.log.length, 0);
});

test("walking in Street View tells the jump service about presses; the map cancels jumps", () => {
  const env = setup();
  env.press(B.forward);
  env.tick();
  env.tick();
  env.press(B.back);
  env.tick();
  assert.deepEqual(
    env.jump.onWalk.calls.map(([edge, held]) => [edge, held]),
    [
      ["fwd", true],
      [null, true],
      ["back", false],
    ],
  );
  env.state.streetView = false;
  env.tick();
  assert.equal(env.jump.cancel.calls.length, 1);
});

test("without a gamepad, or in a hidden tab, everything is released", () => {
  const env = setup();
  env.press(B.forward, B.mode);
  env.tick();
  env.state.hidden = true;
  env.tick();
  assert.deepEqual(env.sv.log, ["forward down", "forward up"]);
  assert.deepEqual(env.sv.looks.at(-1), [0, 0, 0]);
  env.state.hidden = false;
  env.tick(); // mode still held after the release: counts as a new press
  assert.equal(env.commands.mode.calls.length, 2);
  env.state.pads = [];
  env.tick();
  assert.equal(env.sv.log.at(-1), "forward up");
});

test("debug log: pressed buttons and the view, only on changes", () => {
  const env = setup();
  env.press(B.back);
  env.tick();
  env.tick();
  const lines = env.log.calls.map((c) => c.slice(1).join(" "));
  assert.deepEqual(lines, ["pad 0: [0]", "Street View"]);
});
