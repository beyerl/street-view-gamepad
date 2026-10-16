const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadScripts, plain } = require("./helpers/env");

const { ev } = loadScripts(["settings.js"]);
const defaults = plain(ev("SVG_DEFAULTS"));
const actions = plain(ev("SVG_ACTIONS"));
const injectSource = fs.readFileSync(path.join(ROOT, "inject.js"), "utf8");

test("every action has a default button and vice versa", () => {
  assert.deepEqual(actions.map((a) => a.id).sort(), Object.keys(defaults.buttonMap).sort());
});

test("actions have unique ids and labels", () => {
  assert.equal(new Set(actions.map((a) => a.id)).size, actions.length);
  for (const a of actions) assert.ok(a.label);
});

test("default buttons are unique non-negative integers", () => {
  const buttons = Object.values(defaults.buttonMap);
  assert.equal(new Set(buttons).size, buttons.length);
  for (const b of buttons) assert.ok(Number.isInteger(b) && b >= 0);
});

test("volumes are within 0-100", () => {
  for (const k of ["masterVolume", "volume", "commentaryVolume"]) {
    assert.ok(defaults[k] >= 0 && defaults[k] <= 100, k);
  }
});

test("default button map matches DEFAULT_BUTTON_MAP in inject.js", () => {
  const block = injectSource.match(/const DEFAULT_BUTTON_MAP = (\{[\s\S]*?\});/)[1];
  assert.deepEqual(plain(eval(`(${block})`)), defaults.buttonMap);
});

test("inject.js starts with the same look speeds, log level and sound setting", () => {
  const block = injectSource.match(/const settings = (\{[\s\S]*?\n {2}\});/)[1];
  const injectDefaults = eval(`(${block.replace("buttonMap: DEFAULT_BUTTON_MAP,", "")})`);
  for (const k of ["lookSpeedX", "lookSpeedY", "logLevel", "soundEnabled"]) {
    assert.equal(injectDefaults[k], defaults[k], k);
  }
});

test("manifest has a version and the scripts it lists exist", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const files = [manifest.background.service_worker, ...manifest.content_scripts.flatMap((c) => c.js)];
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});
