import { test } from "node:test";
import assert from "node:assert/strict";
import { InputController } from "../../src/application/input-controller.js";
import { Action, presetButtonMap } from "../../src/domain/actions.js";
import { Mode, ModeCommand } from "../../src/domain/mode.js";
import { withDefaults } from "../../src/domain/settings.js";
import { makeClock, pad, spy } from "../helpers/fakes.js";

// Buttons only, so pad() can press them all.
const B = presetButtonMap("snes");

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
      [Action.FORWARD, Action.BACK, Action.ZOOM_IN].includes(name) &&
      !(walkPans && [Action.FORWARD, Action.BACK].includes(name))
        ? held(name)
        : null,
    look(dx, dy, dt) {
      this.looks.push([dx, dy, dt]);
    },
  };
}

function setup({ buttonMap = {}, streetView = true, mode = Mode.LEVELS } = {}) {
  const clock = makeClock();
  const state = { pads: [], hidden: false, streetView, mode };
  const sv = controls(false);
  const map = controls(true);
  const jump = { onWalk: spy(), cancel: spy(), checkingBack: false };
  const commands = Object.fromEntries([...Object.values(Action), ...Object.values(ModeCommand)].map((a) => [a, spy()]));
  const log = spy();
  const c = new InputController({
    input: { pads: () => state.pads },
    settings: withDefaults({ buttonMap: { ...B, ...buttonMap } }),
    isHidden: () => state.hidden,
    isStreetView: () => state.streetView,
    streetView: sv,
    map,
    jump,
    commands,
    mode: () => state.mode,
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
  const env = setup({ buttonMap: { strafeRight: "a1-", strafeLeft: 6 } });
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
  assert.equal(env.commands.strafeRight.calls.length, 1);
  assert.equal(env.commands.strafeLeft.calls.length, 1);
});

test("mode buttons run what the current mode assigns to them, once per press", () => {
  const env = setup();
  env.press(B.mode1);
  env.tick();
  env.tick(500);
  env.press(B.mode2); // nothing in floors mode
  env.tick();
  env.press(B.mode3);
  env.tick();
  assert.equal(env.commands.levelUp.calls.length, 1);
  assert.equal(env.commands.levelDown.calls.length, 1);
  env.press();
  env.tick();
  env.state.mode = Mode.BROWSER;
  env.press(B.mode1, B.mode2, B.mode3);
  env.tick();
  for (const c of ["fullscreen", "overlay", "historyBack"]) assert.equal(env.commands[c].calls.length, 1, c);
});

test("minimap zoom repeats while held; the command stays the one from the press", () => {
  const env = setup({ mode: Mode.MINIMAP });
  env.press(B.mode1, B.mode2);
  env.tick();
  env.state.mode = Mode.LEVELS; // switched while held: no effect until released
  env.tick(400);
  env.tick(150);
  assert.equal(env.commands.minimapToggle.calls.length, 1);
  assert.equal(env.commands.minimapZoomIn.calls.length, 3);
  assert.equal(env.commands.levelUp.calls.length, 0);
  env.press();
  env.tick();
  env.press(B.mode1);
  env.tick();
  assert.equal(env.commands.levelUp.calls.length, 1);
});

test("a mode command that throws still runs only once per press", () => {
  const env = setup();
  let runs = 0;
  env.commands.levelUp = () => {
    runs++;
    throw new Error("boom");
  };
  env.press(B.mode1);
  assert.throws(() => env.tick());
  env.tick();
  env.tick(500);
  assert.equal(runs, 1);
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
