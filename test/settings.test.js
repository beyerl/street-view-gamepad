const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { load, root } = require("./helpers");

const { SVG_DEFAULTS, SVG_ACTIONS } = load("settings.js", {}, ["SVG_DEFAULTS", "SVG_ACTIONS"]);

test("every action has a default button, and vice versa", () => {
  const ids = SVG_ACTIONS.map((a) => a.id).sort();
  assert.deepEqual(Object.keys(SVG_DEFAULTS.buttonMap).sort(), ids);
});

test("default buttons are unique non-negative integers", () => {
  const buttons = Object.values(SVG_DEFAULTS.buttonMap);
  assert.ok(buttons.every((b) => Number.isInteger(b) && b >= 0));
  assert.equal(new Set(buttons).size, buttons.length);
});

test("action ids are unique and labelled", () => {
  const ids = SVG_ACTIONS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(SVG_ACTIONS.every((a) => a.label.length > 0));
});

test("volumes are within 0-100", () => {
  for (const k of ["masterVolume", "volume", "commentaryVolume"]) {
    assert.ok(SVG_DEFAULTS[k] >= 0 && SVG_DEFAULTS[k] <= 100, k);
  }
});

test("default button map matches DEFAULT_BUTTON_MAP in inject.js", () => {
  const src = fs.readFileSync(path.join(root, "inject.js"), "utf8");
  const body = src.match(/DEFAULT_BUTTON_MAP = (\{[^}]*\})/)[1];
  const injected = vm.runInNewContext(`(${body})`);
  assert.deepEqual({ ...injected }, { ...SVG_DEFAULTS.buttonMap });
});
