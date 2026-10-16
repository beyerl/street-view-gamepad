const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts, plain, flush, makeChrome, makeWindow } = require("./helpers/env");
const { makeDocument } = require("./helpers/dom");

async function setup({ sync, session } = {}) {
  const chrome = makeChrome({ sync, session });
  const document = makeDocument();
  const window = makeWindow();
  document.el("soundEnabled").type = "checkbox";
  const env = loadScripts(["settings.js", "popup.js"], { chrome, document, window });
  await flush();
  return { chrome, document, window, ...env };
}

test("shows the stored settings merged with the defaults", async () => {
  const { document } = await setup({ sync: { volume: 20, soundEnabled: false, logLevel: "debug" } });
  assert.equal(document.el("volume").value, 20);
  assert.equal(document.el("volume-out").textContent, "20");
  assert.equal(document.el("soundEnabled").checked, false);
  assert.equal(document.el("logLevel").value, "debug");
  assert.equal(document.el("lookSpeedX").value, 720); // default
});

test("saves a changed number input as a number", async () => {
  const { chrome, document } = await setup();
  const el = document.el("volume");
  el.value = "35";
  el.dispatchEvent({ type: "input", target: el });
  assert.deepEqual(plain(chrome.storage.sync.set.calls.at(-1)), [{ volume: 35 }]);
  assert.equal(document.el("volume-out").textContent, "35");
});

test("saves a checkbox as a boolean and a select as a string", async () => {
  const { chrome, document } = await setup();
  const box = document.el("soundEnabled");
  box.checked = false;
  box.dispatchEvent({ type: "input", target: box });
  assert.deepEqual(plain(chrome.storage.sync.set.calls.at(-1)), [{ soundEnabled: false }]);

  const select = document.el("logLevel");
  select.value = "off";
  select.dispatchEvent({ type: "input", target: select });
  assert.deepEqual(plain(chrome.storage.sync.set.calls.at(-1)), [{ logLevel: "off" }]);
});

test("the button map is not a popup control", async () => {
  const { chrome, document } = await setup();
  assert.equal(document.el("buttonMap").listeners.input, undefined);
  assert.equal(chrome.storage.sync.set.calls.length, 0);
});

test("reset stores the defaults and shows them", async () => {
  const { chrome, document, ev } = await setup({ sync: { volume: 1 } });
  document.el("reset").click();
  await flush();
  assert.deepEqual(plain(chrome.storage.sync.set.calls.at(-1)[0]), plain(ev("SVG_DEFAULTS")));
  assert.equal(document.el("volume").value, 50);
});

test("the mapping button opens the mapping window and closes the popup", async () => {
  const { chrome, document, window } = await setup();
  document.el("mapping").click();
  assert.deepEqual(plain(chrome.windows.create.calls[0]), [
    { url: "mapping.html", type: "popup", width: 520, height: 900 },
  ]);
  assert.equal(window.close.calls.length, 1);
});

test("shows the attribution of what is playing", async () => {
  const nowPlaying = {
    title: "Dawn chorus", place: "Berlin", artist: "Jane", licence: "CC BY", recdate: "2020-05-01",
    km: 1.5, link: "https://aporee.org/maps/?loc=7",
  };
  const { document } = await setup({ session: { nowPlaying } });
  assert.equal(document.el("nowPlaying").hidden, false);
  assert.equal(document.el("np-title").textContent, "Dawn chorus");
  assert.equal(document.el("np-title").href, "https://aporee.org/maps/?loc=7");
  assert.equal(
    document.el("np-meta").textContent,
    "Berlin · 1.5 km away · by Jane, 2020-05-01 · CC BY · radio aporee ::: maps",
  );
});

test("hides the attribution box when nothing plays and falls back to the place name", async () => {
  const { chrome, document } = await setup();
  assert.equal(document.el("nowPlaying").hidden, true);

  chrome.storage.onChanged.emit({ nowPlaying: { newValue: { place: "Park", km: 2, link: "x" } } }, "session");
  assert.equal(document.el("nowPlaying").hidden, false);
  assert.equal(document.el("np-title").textContent, "Park");

  chrome.storage.onChanged.emit({ nowPlaying: { newValue: undefined } }, "session");
  assert.equal(document.el("nowPlaying").hidden, true);
});

test("only reacts to nowPlaying changes in session storage", async () => {
  const { chrome, document } = await setup();
  chrome.storage.onChanged.emit({ nowPlaying: { newValue: { place: "P", km: 1, link: "x" } } }, "sync");
  chrome.storage.onChanged.emit({ other: { newValue: 1 } }, "session");
  assert.equal(document.el("nowPlaying").hidden, true);
});
