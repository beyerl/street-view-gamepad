const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts, plain, flush, makeChrome, makeWindow } = require("./helpers/env");

async function setup(sync) {
  const chrome = makeChrome({ sync });
  const window = makeWindow();
  const env = loadScripts(["settings.js", "bridge.js"], { chrome, window });
  await flush();
  return { chrome, window, ...env };
}

const sent = (chrome) => chrome.runtime.sendMessage.calls.map((c) => plain(c[0]));
const settingsPosts = (window) => window.posted.filter((m) => m.type === "settings");

test("pushes the stored settings merged with the defaults on load", async () => {
  const { window, ev } = await setup({ lookSpeedX: 100 });
  const [msg] = window.posted;
  assert.equal(msg.source, "sv-gamepad-bridge");
  assert.equal(msg.type, "settings");
  assert.equal(msg.settings.lookSpeedX, 100);
  assert.deepEqual(plain(msg.settings.buttonMap), plain(ev("SVG_DEFAULTS.buttonMap")));
});

test("forwards page messages to the background worker", async () => {
  const { chrome, window } = await setup();
  window.message({ source: "sv-gamepad", type: "toggleFullscreen" });
  window.message({ source: "sv-gamepad", type: "ambient", lat: 1, lng: 2 });
  window.message({ source: "sv-gamepad", type: "ambientStop" });
  window.message({ source: "sv-gamepad", type: "commentaryAt", lat: 3, lng: 4 });
  window.message({ source: "sv-gamepad", type: "commentaryToggle" });
  window.message({ source: "sv-gamepad", type: "commentaryPause" });
  assert.deepEqual(sent(chrome), [
    { type: "toggleFullscreen" },
    { type: "ambient", lat: 1, lng: 2 },
    { type: "ambientStop" },
    { type: "commentaryAt", lat: 3, lng: 4 },
    { type: "commentaryToggle" },
    { type: "commentaryPause" },
  ]);
});

test("ignores messages from other windows, other sources and unknown types", async () => {
  const { chrome, window } = await setup();
  window.message({ source: "sv-gamepad", type: "ambientStop" }, {});
  window.message({ source: "somebody-else", type: "ambientStop" });
  window.message({ source: "sv-gamepad", type: "bogus" });
  window.message(null);
  assert.deepEqual(sent(chrome), []);
});

test("getSettings pushes the settings again", async () => {
  const { window } = await setup();
  window.message({ source: "sv-gamepad", type: "getSettings" });
  await flush();
  assert.equal(settingsPosts(window).length, 2);
});

test("leaving the page stops the sound", async () => {
  const { chrome, window } = await setup();
  window.dispatch("pagehide", {});
  assert.deepEqual(sent(chrome), [{ type: "ambientStop" }]);
});

test("relays commentary state and notices from the background worker", async () => {
  const { chrome, window } = await setup();
  const [listener] = chrome.runtime.onMessage.fns;
  listener({ type: "commentary", state: { available: true } });
  listener({ type: "commentaryNotice", message: "hi", ms: 5 });
  listener({ type: "other" });
  listener(undefined);
  assert.deepEqual(plain(window.posted.filter((m) => m.type !== "settings")), [
    { source: "sv-gamepad-bridge", type: "commentary", state: { available: true } },
    { source: "sv-gamepad-bridge", type: "commentaryNotice", message: "hi", ms: 5 },
  ]);
});

test("pushes settings again when sync storage changes, but not other areas", async () => {
  const { chrome, window } = await setup();
  chrome.storage.onChanged.emit({}, "local");
  await flush();
  assert.equal(settingsPosts(window).length, 1);
  chrome.storage.onChanged.emit({}, "sync");
  await flush();
  assert.equal(settingsPosts(window).length, 2);
});
