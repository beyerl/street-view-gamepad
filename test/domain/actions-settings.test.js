import { test } from "node:test";
import assert from "node:assert/strict";
import { Action, ActionKind, ACTIONS, actionsOfKind, defaultButtonMap } from "../../src/domain/actions.js";
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

test("default buttons are unique non-negative integers, or unassigned", () => {
  const buttons = Object.values(defaultButtonMap()).filter((b) => b !== null);
  assert.equal(new Set(buttons).size, buttons.length);
  for (const b of buttons) assert.ok(Number.isInteger(b) && b >= 0);
  assert.equal(defaultButtonMap()[Action.FORWARD], 3);
  assert.equal(defaultButtonMap()[Action.STRAFE_LEFT], null);
});

test("actions by kind", () => {
  assert.deepEqual(actionsOfKind(ActionKind.LOOK), [
    Action.LOOK_UP,
    Action.LOOK_DOWN,
    Action.LOOK_LEFT,
    Action.LOOK_RIGHT,
  ]);
  assert.ok(actionsOfKind(ActionKind.HELD).includes(Action.MINIMAP_ZOOM_IN));
  assert.ok(actionsOfKind(ActionKind.PRESS).includes(Action.HISTORY_BACK));
});

test("stored settings are completed with the defaults, including new actions", () => {
  const s = withDefaults({ lookSpeedX: 1000, buttonMap: { forward: 7 } });
  assert.equal(s.lookSpeedX, 1000);
  assert.equal(s.lookSpeedY, DEFAULT_SETTINGS.lookSpeedY);
  assert.equal(s.buttonMap.forward, 7);
  assert.equal(s.buttonMap.back, 0);
  assert.equal(s.buttonMap.articleNext, null);
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
