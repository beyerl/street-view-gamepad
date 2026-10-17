import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Action,
  ActionKind,
  ACTIONS,
  actionsOfKind,
  defaultButtonMap,
  MODE_BUTTONS,
  normalizeButtonMap,
  PRESETS,
  presetButtonMap,
  presetOf,
} from "../../src/domain/actions.js";
import { DEFAULT_SETTINGS, effectiveVolumes, LogLevel, logEnabled, withDefaults } from "../../src/domain/settings.js";

test("every action has a unique id from Action, a label and a known kind", () => {
  const ids = ACTIONS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), Object.values(Action).sort());
  for (const a of ACTIONS) {
    assert.ok(a.label);
    assert.ok(Object.values(ActionKind).includes(a.kind), a.id);
  }
});

test("presets bind every action, each input at most once, to a button or an axis", () => {
  assert.deepEqual(
    PRESETS.map((p) => p.id),
    ["xbox", "snes"],
  );
  for (const p of PRESETS) {
    assert.deepEqual(Object.keys(p.map).sort(), ACTIONS.map((a) => a.id).sort(), p.id);
    const inputs = Object.values(p.map).filter((b) => b !== null);
    assert.equal(new Set(inputs).size, inputs.length, p.id);
    for (const b of inputs) assert.ok((Number.isInteger(b) && b >= 0) || /^a\d+[+-]$/.test(String(b)), `${p.id} ${b}`);
  }
});

test("the Xbox preset is the default: face buttons walk and step, stick looks, D-pad runs the modes", () => {
  assert.deepEqual(defaultButtonMap(), presetButtonMap("xbox"));
  assert.deepEqual(presetButtonMap("bogus"), presetButtonMap("xbox"));
  const x = presetButtonMap("xbox");
  assert.deepEqual([x.forward, x.back, x.strafeLeft, x.strafeRight], [4, 0, 3, 1]);
  assert.deepEqual([x.lookUp, x.lookDown, x.lookLeft, x.lookRight], ["a1-", "a1+", "a0-", "a0+"]);
  assert.deepEqual([x.zoomIn, x.zoomOut], [6, 7]);
  assert.deepEqual([x.mode, x.mode1, x.mode2, x.mode3], [14, 12, 15, 13]);
});

test("the SNES preset: D-pad looks, X/B zoom, select / start / shoulders run the modes, no stepping", () => {
  const s = presetButtonMap("snes");
  assert.deepEqual([s.forward, s.back, s.strafeLeft, s.strafeRight], [3, 0, null, null]);
  assert.deepEqual([s.lookUp, s.lookDown, s.lookLeft, s.lookRight], [12, 13, 14, 15]);
  assert.deepEqual([s.zoomIn, s.zoomOut], [2, 1]);
  assert.deepEqual([s.mode, s.mode1, s.mode2, s.mode3], [8, 9, 4, 5]);
});

test("a map is a preset only if it binds exactly the same", () => {
  assert.equal(presetOf(presetButtonMap("snes")), "snes");
  assert.equal(presetOf(defaultButtonMap()), "xbox");
  assert.equal(presetOf({ ...defaultButtonMap(), forward: 10 }), null);
});

test("stored maps: unknown actions dropped, missing ones defaulted, maps from before the mode buttons reset", () => {
  assert.deepEqual(normalizeButtonMap(undefined), defaultButtonMap());
  const m = normalizeButtonMap({ mode1: 10, forward: 7, historyForward: 4 });
  assert.equal(m.mode1, 10);
  assert.equal(m.forward, 7);
  assert.equal(m.back, 0);
  assert.equal("historyForward" in m, false);
  assert.deepEqual(normalizeButtonMap({ forward: 7, action: 1 }), defaultButtonMap());
  // v1.10.0's Xbox preset got walk and step wrong (#19): a stored copy is replaced.
  const old = { ...defaultButtonMap(), forward: 3, strafeLeft: 2 };
  assert.deepEqual(normalizeButtonMap(old), defaultButtonMap());
  assert.equal(normalizeButtonMap({ ...old, zoomIn: 8 }).forward, 3); // customized: kept
});

test("actions by kind", () => {
  assert.deepEqual(actionsOfKind(ActionKind.LOOK), [
    Action.LOOK_UP,
    Action.LOOK_DOWN,
    Action.LOOK_LEFT,
    Action.LOOK_RIGHT,
  ]);
  assert.deepEqual(actionsOfKind(ActionKind.HELD), [Action.FORWARD, Action.BACK, Action.ZOOM_IN, Action.ZOOM_OUT]);
  assert.deepEqual(MODE_BUTTONS, [Action.MODE_1, Action.MODE_2, Action.MODE_3]);
});

test("stored settings are completed with the defaults, including new actions", () => {
  const s = withDefaults({ lookSpeedX: 1000, buttonMap: { forward: 7, mode1: 12 } });
  assert.equal(s.lookSpeedX, 1000);
  assert.equal(s.lookSpeedY, DEFAULT_SETTINGS.lookSpeedY);
  assert.equal(s.buttonMap.forward, 7);
  assert.equal(s.buttonMap.back, 0);
  assert.deepEqual(withDefaults(), { ...DEFAULT_SETTINGS, buttonMap: { ...DEFAULT_SETTINGS.buttonMap } });
});

test("defaults are sane", () => {
  for (const k of ["masterVolume", "volume", "commentaryVolume"])
    assert.ok(DEFAULT_SETTINGS[k] >= 0 && DEFAULT_SETTINGS[k] <= 100);
  assert.ok(Object.values(LogLevel).includes(DEFAULT_SETTINGS.logLevel));
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS) && Object.isFrozen(DEFAULT_SETTINGS.buttonMap));
});

test("log levels: off shows nothing, info hides debug, unknown counts as info", () => {
  assert.equal(logEnabled("off", "info"), false);
  assert.equal(logEnabled("info", "info"), true);
  assert.equal(logEnabled("info", "debug"), false);
  assert.equal(logEnabled("debug", "debug"), true);
  assert.equal(logEnabled("bogus", "info"), true);
  assert.equal(logEnabled("bogus", "debug"), false);
});

test("volumes are scaled by the master volume", () => {
  assert.deepEqual(effectiveVolumes({ masterVolume: 50, volume: 50, commentaryVolume: 100 }), {
    ambient: 0.25,
    commentary: 0.5,
  });
});
