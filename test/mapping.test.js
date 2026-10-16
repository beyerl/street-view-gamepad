const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts, plain, flush, makeChrome, makeClock } = require("./helpers/env");
const { makeDocument, makeGamepad } = require("./helpers/dom");

async function setup({ sync, pads = [] } = {}) {
  const chrome = makeChrome({ sync });
  const document = makeDocument();
  const clock = makeClock();
  const state = { pads };
  const env = loadScripts(["settings.js", "mapping.js"], {
    chrome, document, navigator: { getGamepads: () => state.pads }, ...clock.globals,
  });
  await flush();
  const poll = () => clock.tick(30);
  const rows = () => document.el("list").children;
  const stored = () => plain(chrome.storage.sync.data.buttonMap);
  return { chrome, document, state, poll, rows, stored, ...env };
}

const press = (...buttons) => [makeGamepad(buttons)];

test("lists all actions with their current buttons", async () => {
  const { rows, ev } = await setup({ sync: { buttonMap: { forward: 7 } } });
  const actions = plain(ev("SVG_ACTIONS"));
  assert.equal(rows().length, actions.length);
  assert.equal(rows()[0].children[0].textContent, actions[0].label);
  assert.equal(rows()[0].children[1].textContent, "Button 7");
  assert.equal(rows()[1].children[1].textContent, "Button 0"); // default for back
});

test("shows a dash for an unassigned action", async () => {
  const { rows } = await setup({ sync: { buttonMap: { forward: null } } });
  assert.equal(rows()[0].children[1].textContent, "—");
});

test("is idle until started", async () => {
  const { document } = await setup();
  assert.equal(document.el("prompt").textContent, "Idle.");
  assert.equal(document.el("skip").disabled, true);
  assert.equal(document.el("cancel").disabled, true);
  assert.equal(document.el("start").disabled, false);
});

test("reports whether a gamepad is connected", async () => {
  const { document, state, poll } = await setup();
  poll();
  assert.equal(document.el("status").textContent, "No gamepad detected.");
  state.pads = [makeGamepad([], 0), null];
  poll();
  assert.equal(document.el("status").textContent, "Gamepad: Pad 0");
});

test("Configure all walks through the actions and assigns pressed buttons", async () => {
  const { document, state, poll, rows, stored, ev } = await setup();
  document.el("start").click();
  assert.equal(document.el("prompt").textContent, "Press a button for Walk forward / pan north");
  assert.equal(rows()[0].className, "current");
  assert.equal(document.el("start").disabled, true);

  poll(); // nothing pressed yet: arms the input
  state.pads = press(10);
  poll();
  await flush();
  assert.equal(stored().forward, 10);
  assert.equal(document.el("prompt").textContent, "Press a button for Walk backward / pan south");
  assert.equal(rows()[0].children[1].textContent, "Button 10");

  // The same press is not taken twice: wait for the release first.
  poll();
  assert.equal(stored().back, 0);
  state.pads = press();
  poll();
  state.pads = press(11);
  poll();
  await flush();
  assert.equal(stored().back, 11);
  assert.equal(ev("step"), 2);
});

test("assigning a button takes it away from the action that had it", async () => {
  const { document, state, poll, stored } = await setup();
  document.el("start").click();
  poll();
  state.pads = press(0); // back's default button
  poll();
  await flush();
  assert.equal(stored().forward, 0);
  assert.equal(stored().back, null);
});

test("clicking a row configures only that action", async () => {
  const { document, state, poll, rows, stored } = await setup();
  rows()[2].click(); // lookUp
  assert.equal(document.el("prompt").textContent, "Press a button for Look up");
  poll();
  state.pads = press(6);
  poll();
  await flush();
  assert.equal(stored().lookUp, 6);
  assert.equal(document.el("prompt").textContent, "Idle.");
});

test("skip, Enter, cancel and Escape", async () => {
  const { document, rows } = await setup();
  document.el("start").click();
  document.el("skip").click();
  assert.equal(document.el("prompt").textContent, "Press a button for Walk backward / pan south");
  document.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(document.el("prompt").textContent, "Press a button for Look up");
  document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(document.el("prompt").textContent, "Idle.");
  assert.equal(rows().every((r) => r.className === ""), true);

  document.el("start").click();
  document.el("cancel").click();
  assert.equal(document.el("prompt").textContent, "Idle.");
});

test("keys are ignored while idle", async () => {
  const { document } = await setup();
  document.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(document.el("prompt").textContent, "Idle.");
});

test("buttons are ignored while idle", async () => {
  const { chrome, state, poll } = await setup();
  state.pads = press(10);
  poll();
  poll();
  assert.equal(chrome.storage.sync.set.calls.length, 0);
});

test("finishing the last action ends the configuration", async () => {
  const { document, state, poll, ev } = await setup();
  const count = plain(ev("SVG_ACTIONS")).length;
  document.el("start").click();
  for (let i = 0; i < count; i++) document.el("skip").click();
  assert.equal(document.el("prompt").textContent, "Idle.");
  assert.equal(ev("step"), -1);
  state.pads = press(10);
  poll();
});

test("Reset mapping stores the default map", async () => {
  const { chrome, document, rows, stored, ev } = await setup({ sync: { buttonMap: { forward: 7 } } });
  document.el("defaults").click();
  await flush();
  assert.deepEqual(stored(), plain(ev("SVG_DEFAULTS.buttonMap")));
  assert.equal(chrome.storage.sync.set.calls.length, 1);
  assert.equal(rows()[0].children[1].textContent, "Button 3");
});
