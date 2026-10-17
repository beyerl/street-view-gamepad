// The bridge, background worker, offscreen document, popup and key mapping
// window, each wired up as in the browser.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startBridge } from "../../src/entry/bridge.js";
import { startBackground } from "../../src/entry/background.js";
import { startOffscreen } from "../../src/entry/offscreen.js";
import { MAPPING_WINDOW, startPopup } from "../../src/entry/popup.js";
import { startMapping } from "../../src/entry/mapping.js";
import { DEFAULT_SETTINGS } from "../../src/domain/settings.js";
import { closeDoms, makeDom } from "../helpers/dom.js";
import { flush, makeChrome, makeClock, pad, plain, router, spy } from "../helpers/fakes.js";

after(closeDoms);

function fakeWindow() {
  const handlers = {};
  const w = {
    posted: [],
    addEventListener: (t, f) => (handlers[t] ||= []).push(f),
    postMessage: (data) => w.posted.push(data),
    dispatch: (t, ev) => (handlers[t] || []).forEach((f) => f(ev)),
    fromPage: (data) => w.dispatch("message", { source: w, data: { source: "sv-gamepad", ...data } }),
  };
  return w;
}

// --- bridge -----------------------------------------------------------------------------

test("bridge: pushes settings merged with the defaults, on load, on request and on change", async () => {
  const window = fakeWindow();
  const chrome = makeChrome({ sync: { lookSpeedX: 1000, buttonMap: { forward: 7, mode1: 12 } } });
  startBridge({ window, chrome });
  await flush();
  const settings = window.posted[0].settings;
  assert.equal(settings.lookSpeedX, 1000);
  assert.equal(settings.buttonMap.forward, 7);
  assert.equal(settings.buttonMap.back, 0);
  window.fromPage({ type: "getSettings" });
  chrome.storage.onChanged.emit({}, "sync");
  chrome.storage.onChanged.emit({}, "local");
  await flush();
  assert.equal(window.posted.length, 3);
});

test("bridge: forwards page messages with only their fields; relays background messages", async () => {
  const window = fakeWindow();
  const chrome = makeChrome();
  startBridge({ window, chrome });
  window.fromPage({ type: "ambient", lat: 1, lng: 2, extra: "x" });
  window.fromPage({ type: "commentaryNext", step: -1 });
  window.fromPage({ type: "toggleFullscreen" });
  window.fromPage({ type: "unknown" });
  window.dispatch("message", { source: {}, data: { source: "sv-gamepad", type: "ambientStop" } });
  window.dispatch("pagehide", {});
  assert.deepEqual(
    chrome.runtime.sendMessage.calls.map((c) => c[0]),
    [
      { type: "ambient", lat: 1, lng: 2 },
      { type: "commentaryNext", step: -1 },
      { type: "toggleFullscreen" },
      { type: "ambientStop" },
    ],
  );
  chrome.runtime.onMessage.emit({ type: "commentary", state: { available: true } });
  chrome.runtime.onMessage.emit({ type: "other" });
  assert.deepEqual(
    window.posted.filter((m) => m.type === "commentary"),
    [{ source: "sv-gamepad-bridge", type: "commentary", state: { available: true } }],
  );
});

// --- background -------------------------------------------------------------------------

const wiki = (key) => (url) => url.startsWith("https://en.wikipedia.org/") && url.includes(key);

function background({ sync = {} } = {}) {
  const chrome = makeChrome({ sync });
  const fetch = router([
    [(u) => u.includes("getAllLocations"), [{ locid: "1", lat: "52.52", lng: "13.405" }]],
    [(u) => u.includes("getPlaylist"), [{ mp3: "https://aporee.org/a.mp3", ctitle: "Dawn" }]],
    [
      wiki("generator=geosearch"),
      {
        query: {
          pages: [
            { pageid: 1, length: 100 },
            { pageid: 2, length: 9000 },
          ],
        },
      },
    ],
    [
      wiki("prop=extracts"),
      (u) => ({ query: { pages: [{ title: `Title ${new URL(u).searchParams.get("pageids")}`, extract: "Text." }] } }),
    ],
  ]);
  const console = { log: spy(), warn: spy() };
  const app = startBackground({ chrome, fetch, console, random: () => 0, now: () => 0 });
  const fromTab = (msg, tab = { id: 5, windowId: 9 }) => chrome.runtime.onMessage.emit(msg, { tab });
  const offscreen = () => chrome.runtime.sendMessage.calls.map((c) => c[0]).filter((m) => m.target === "offscreen");
  return { app, chrome, fetch, console, fromTab, offscreen };
}

test("background: the aporee rule, the languages, and messages without a tab ignored", async () => {
  const env = background();
  assert.equal(
    env.chrome.declarativeNetRequest.updateSessionRules.calls[0][0].addRules[0].condition.initiatorDomains[0],
    "ext-id",
  );
  assert.deepEqual(env.app.langs, ["en"]);
  env.chrome.runtime.onMessage.emit({ type: "ambient", lat: 1, lng: 2 }, {});
  await flush();
  assert.equal(env.fetch.calls.length, 0);
});

test("background: ambient end to end, with volumes from the settings", async () => {
  const env = background({ sync: { masterVolume: 50, volume: 50 } });
  env.fromTab({ type: "ambient", lat: 52.5, lng: 13.4 });
  await flush();
  assert.deepEqual(env.offscreen()[0], {
    target: "offscreen",
    volume: 0.25,
    commentaryVolume: 0.5,
    type: "play",
    url: "https://aporee.org/a.mp3",
  });
  assert.equal(env.chrome.storage.session.data.nowPlaying.title, "Dawn");
  env.chrome.storage.onChanged.emit({ soundEnabled: { newValue: false } }, "sync");
  env.chrome.storage.onChanged.emit({ volume: { newValue: 10 } }, "sync");
  await flush();
  assert.deepEqual(
    env
      .offscreen()
      .slice(1)
      .map((m) => m.type),
    ["pause", "volume"],
  );
  env.chrome.tabs.onRemoved.emit(5);
  await flush();
  assert.equal(env.offscreen().at(-1).type, "pause");
});

test("background: fullscreen and commentary end to end", async () => {
  const env = background();
  env.fromTab({ type: "toggleFullscreen" });
  await flush();
  assert.deepEqual(env.chrome.windows.update.calls[0], [9, { state: "fullscreen" }]);
  env.fromTab({ type: "commentaryAt", lat: 52.5, lng: 13.4 });
  await flush();
  env.fromTab({ type: "commentaryToggle" });
  await flush();
  assert.equal(env.offscreen().at(-1).type, "commentarySpeak");
  env.fromTab({ type: "commentaryNext", step: 1 });
  await flush();
  env.fromTab({ type: "commentaryPause" });
  await flush();
  const states = env.chrome.tabs.sendMessage.calls
    .map((c) => c[1])
    .filter((m) => m.type === "commentary")
    .map((m) => m.state);
  assert.deepEqual(states.at(-1), {
    available: true,
    title: "Title 1",
    status: "paused",
    playingTitle: "Title 1",
    loading: false,
    index: 1,
    count: 2,
  });
  env.chrome.runtime.onMessage.emit({ type: "commentaryNotice", message: "Downloading…" }, {});
  env.chrome.runtime.onMessage.emit({ type: "commentaryEnded", error: "boom" }, {});
  const notices = env.chrome.tabs.sendMessage.calls.map((c) => c[1]).filter((m) => m.type === "commentaryNotice");
  assert.deepEqual(
    notices.map((n) => n.message),
    ["Downloading…", "boom"],
  );
});

// --- offscreen --------------------------------------------------------------------------

function offscreen() {
  const clock = makeClock();
  const audio = () => ({
    src: "",
    volume: 1,
    paused: true,
    currentTime: 0,
    play: async function () {
      this.paused = false;
    },
    pause() {
      this.paused = true;
    },
    load() {},
    removeAttribute() {
      this.src = "";
    },
    addEventListener() {},
  });
  const els = { a: audio(), b: audio(), c: audio() };
  const chrome = makeChrome();
  const g = {
    document: { getElementById: (id) => els[id] },
    chrome,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    setTimeout: clock.setTimeout,
    performance: { now: clock.now },
    ort: { env: { wasm: {} } },
    createPiperPhonemize: async () => ({}),
    fetch: spy(),
    caches: {},
    Blob,
    Response,
    Intl,
    URL,
    console: { warn: spy() },
  };
  const app = startOffscreen(g);
  const send = (msg) => {
    let response;
    chrome.runtime.onMessage.emit({ target: "offscreen", ...msg }, {}, (r) => (response = r));
    return response;
  };
  return { app, els, chrome, clock, send };
}

test("offscreen: plays, sets volumes, reports status, and resumes", () => {
  const env = offscreen();
  env.send({ type: "play", url: "u", volume: 0.3, commentaryVolume: 0.7 });
  env.clock.tick(2000);
  assert.deepEqual(plain(env.send({ type: "status" })), { src: "u", paused: false, currentTime: 0, volume: 0.3 });
  assert.equal(env.els.c.volume, 0.7);
  assert.deepEqual(env.send({ type: "commentaryResume" }), { ok: false });
  env.send({ type: "commentaryPlay", url: "r" });
  assert.equal(env.els.c.src, "r");
  env.chrome.runtime.onMessage.emit({ type: "play", url: "x" }, {}, () => {}); // not for us
  assert.equal(env.els.a.src, "");
});

// --- popup and key mapping ------------------------------------------------------------

function extensionPage(file) {
  const { window, document } = makeDom(`chrome-extension://ext-id/${file}`);
  const html = fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, "");
  return { window, document };
}

test("popup: shows the stored settings and saves changes; mapping and reset buttons", async () => {
  const { window, document } = extensionPage("popup.html");
  const chrome = makeChrome({
    sync: { lookSpeedX: 1000 },
    session: {
      nowPlaying: {
        title: "Dawn",
        place: "Berlin",
        km: 2.2,
        artist: "Jane",
        recdate: "2020",
        licence: "CC",
        link: "L",
      },
    },
  });
  const g = Object.assign(window, { chrome, close: spy() });
  await startPopup(g);
  assert.equal(document.getElementById("lookSpeedX").value, "1000");
  assert.equal(
    document.getElementById("lookSpeedX-out") ??
      document.querySelector('svgp-setting[key="lookSpeedX"] output').textContent,
    "1000",
  );
  assert.equal(document.getElementById("soundEnabled").checked, true);
  assert.equal(document.getElementById("np-title").textContent, "Dawn");
  assert.equal(document.getElementById("nowPlaying").hidden, false);
  const volume = document.getElementById("volume");
  volume.value = "70";
  volume.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.deepEqual(chrome.storage.sync.set.calls.at(-1), [{ volume: 70 }]);
  document.getElementById("reset").click();
  await flush();
  assert.equal(chrome.storage.sync.data.lookSpeedX, DEFAULT_SETTINGS.lookSpeedX);
  assert.equal(document.getElementById("lookSpeedX").value, String(DEFAULT_SETTINGS.lookSpeedX));
  chrome.storage.onChanged.emit({ nowPlaying: { newValue: null } }, "session");
  assert.equal(document.getElementById("nowPlaying").hidden, true);
  document.getElementById("mapping").click();
  assert.deepEqual(chrome.windows.create.calls[0][0], { ...MAPPING_WINDOW });
  assert.equal(g.close.calls.length, 1);
});

test("key mapping window: lists the actions, configures with a gamepad, Enter/Escape, presets", async () => {
  const { window, document } = extensionPage("mapping.html");
  const clock = makeClock();
  const chrome = makeChrome({ sync: { buttonMap: { forward: 7, mode1: 12 } } });
  const state = { pads: [] };
  const g = {
    document,
    chrome,
    HTMLElement: window.HTMLElement,
    customElements: window.customElements,
    CustomEvent: window.CustomEvent,
    navigator: { getGamepads: () => state.pads },
    setInterval: clock.setInterval,
  };
  const { session, ready } = startMapping(g);
  await ready;
  const rows = () => [...document.querySelectorAll("#list tr")];
  assert.equal(rows().length, session.actions.length);
  assert.deepEqual(
    [...rows()[0].children].map((td) => td.textContent),
    ["Walk forward / pan north", "Button 7"],
  );
  const preset = /** @type {HTMLSelectElement} */ (document.getElementById("preset"));
  assert.deepEqual(
    [...preset.options].map((o) => [o.value, o.textContent, o.disabled]),
    [
      ["xbox", "Xbox Classic", false],
      ["snes", "SNES", false],
      ["custom", "Custom", true],
    ],
  );
  assert.equal(preset.value, "custom");
  assert.equal(document.querySelectorAll("svgp-mode-table tbody tr").length, 4);
  assert.equal(document.getElementById("prompt").textContent, "Idle.");
  clock.tick(30);
  assert.equal(document.getElementById("status").textContent, "No gamepad detected.");

  document.getElementById("start").click();
  assert.equal(
    document.getElementById("prompt").textContent,
    "Press a button or move a stick for Walk forward / pan north",
  );
  assert.equal(document.getElementById("start").disabled, true);
  state.pads = [pad([])];
  clock.tick(30);
  assert.equal(document.getElementById("status").textContent, "Gamepad: Pad 0");
  state.pads = [pad([10])];
  clock.tick(30);
  await flush();
  assert.equal(chrome.storage.sync.data.buttonMap.forward, 10);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }));
  assert.equal(session.step, 2);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(document.getElementById("prompt").textContent, "Idle.");
  rows()[3].dispatchEvent(new window.MouseEvent("click"));
  assert.equal(session.step, 3);
  document.getElementById("skip").click();
  assert.equal(session.configuring, false); // just that one
  preset.value = "snes";
  preset.dispatchEvent(new window.Event("change"));
  await flush();
  assert.equal(chrome.storage.sync.data.buttonMap.lookUp, 12);
  assert.equal(preset.value, "snes");
  preset.value = "xbox";
  preset.dispatchEvent(new window.Event("change"));
  await flush();
  assert.equal(chrome.storage.sync.data.buttonMap.lookUp, "a1-");
  assert.equal(chrome.storage.sync.data.buttonMap.forward, 4);
});

// --- the built extension -----------------------------------------------------------------

test("manifest and pages only reference files that exist (after npm run build)", () => {
  const root = new URL("../../", import.meta.url);
  const exists = (p) => fs.existsSync(new URL(p, root));
  const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", root), "utf8"));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const files = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((c) => c.js),
    manifest.action.default_popup,
  ];
  for (const page of ["popup.html", "mapping.html", "offscreen.html"]) {
    for (const [, src] of fs.readFileSync(new URL(page, root), "utf8").matchAll(/<script src="([^"]+)"/g))
      files.push(src);
  }
  for (const f of files) assert.ok(exists(f), f);
  for (const f of files.filter((f) => f.startsWith("dist/")))
    assert.doesNotMatch(fs.readFileSync(new URL(f, root), "utf8"), /^\s*import\s/m, f);
  assert.equal(manifest.content_scripts[0].world, "MAIN");
});
