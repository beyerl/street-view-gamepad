// The page script wired up as in the browser, on a real DOM with fake time,
// gamepads and network.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { startPage } from "../../src/entry/page.js";
import { Source } from "../../src/shared/messages.js";
import { closeDoms, computedStyle, eventClasses, makeDom, recordEvents, setRect } from "../helpers/dom.js";
import { flush, makeClock, pad, spy, textResponse } from "../helpers/fakes.js";

after(closeDoms);

const PANO = "https://www.google.com/maps/@52.5,13.4,3a,75y,90h,90t/data=!3m6!1e1!3m4!1sPANO1!2e0!7i16384!8i8192";
const panoReply = () =>
  textResponse(
    `)]}'\n${JSON.stringify([null, [null, [2, "PANO2"], null, null, null, [[null, [[null, null, 52.5, 13.400295]]]]]])}`,
  );

function setup({ href = PANO, session = {} } = {}) {
  const { window: hd, document } = makeDom(href);
  const clock = makeClock();
  const handlers = {};
  const window = {
    innerWidth: 1000,
    innerHeight: 800,
    posted: [],
    addEventListener: (t, f) => (handlers[t] ||= []).push(f),
    postMessage: (data) => window.posted.push(data),
    dispatch: (t, ev) => (handlers[t] || []).forEach((f) => f(ev)),
  };
  const store = new Map(Object.entries(session));
  const state = { pads: [] };
  const console = { log: spy(), warn: spy() };
  const location = { href, origin: "https://www.google.com", search: "", assign: spy() };
  const scene = document.createElement("canvas");
  scene.className = "widget-scene-canvas";
  document.body.appendChild(scene);
  setRect(scene, 0, 0, 800, 600);
  const g = {
    document,
    window,
    console,
    ...eventClasses(hd),
    HTMLElement: hd.HTMLElement,
    customElements: hd.customElements,
    setInterval: clock.setInterval,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    performance: { now: clock.now },
    sessionStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    location,
    history: { back: spy(), forward: spy() },
    navigator: { getGamepads: () => state.pads },
    fetch: spy(async () => panoReply()),
    getComputedStyle: computedStyle(),
  };
  const app = startPage(g);
  const fromBridge = (msg) => window.dispatch("message", { source: window, data: { source: Source.BRIDGE, ...msg } });
  const posted = (type) => window.posted.filter((m) => m.type === type);
  const rec = recordEvents(scene);
  return {
    app,
    g,
    clock,
    state,
    store,
    document,
    window,
    scene,
    location,
    console,
    fromBridge,
    posted,
    rec,
    press: (...b) => (state.pads = [pad(b)]),
  };
}

test("asks for the settings and applies them", () => {
  const env = setup();
  assert.deepEqual(env.window.posted[0], { source: Source.PAGE, type: "getSettings" });
  env.fromBridge({ type: "settings", settings: { lookSpeedX: 1000, buttonMap: { lookRight: 9, mode1: 12 } } });
  env.press(9);
  env.clock.tick(16);
  const move = env.rec.of("pointermove")[0];
  assert.ok(Math.abs(move.clientX - (400 - 16)) < 1e-9);
  assert.equal(env.app.settings.buttonMap.forward, 4); // defaults kept
});

test("forward in Street View presses ArrowUp on the scene; the HUD shows with a gamepad", () => {
  const env = setup();
  env.press(4);
  env.clock.tick(16);
  assert.equal(env.rec.of("keydown")[0].key, "ArrowUp");
  env.clock.tick(500);
  const hud = env.document.querySelector("svgp-hud");
  assert.equal(hud.hidden, false);
  assert.equal(hud.chip("levels").classList.contains("active"), true);
});

test("the mode select button switches mode, remembered for the tab, and looks up commentary", () => {
  const env = setup();
  env.press(14);
  env.clock.tick(16);
  assert.equal(env.store.get("svgp-mode"), "commentary");
  assert.deepEqual(env.posted("commentaryAt")[0], { source: Source.PAGE, type: "commentaryAt", lat: 52.5, lng: 13.4 });
  env.fromBridge({
    type: "commentary",
    state: { available: true, title: "Tor", status: "stopped", playingTitle: "", index: 1, count: 3 },
  });
  assert.equal(
    env.document.querySelector("svgp-hud").chip("commentary").querySelector("span").textContent,
    "Tor (2/3)",
  );
});

test("shows the next jump point and jumps there from a dead end", async () => {
  const env = setup();
  env.clock.tick(250 + 400 + 16);
  await flush();
  assert.equal(env.document.querySelector("svgp-hint").text, "Next jump point 20 m");
  env.press(4);
  env.clock.tick(1300);
  assert.deepEqual(env.location.assign.calls, [
    ["https://www.google.com/maps/@52.5,13.400295,3a,75y,90.00h,90t/data=!3m4!1e1!3m2!1sPANO2!2e0"],
  ]);
});

test("reports the position for ambient sound; a hidden tab stops it and pauses commentary", () => {
  const env = setup();
  assert.equal(env.posted("ambient").length, 1);
  Object.defineProperty(env.document, "hidden", { value: true, configurable: true });
  env.document.dispatchEvent(new env.document.defaultView.Event("visibilitychange"));
  assert.equal(env.posted("ambientStop").length, 1);
  assert.equal(env.posted("commentaryPause").length, 1);
});

test("browser mode buttons, notices from the background, and gamepad connection logs", () => {
  const env = setup();
  env.app.modes.set("browser");
  env.press(13); // mode button 3
  env.clock.tick(16);
  assert.equal(env.g.history.back.calls.length, 1);
  env.press(12); // mode button 1
  env.clock.tick(16);
  assert.equal(env.posted("toggleFullscreen").length, 1);
  env.fromBridge({ type: "commentaryNotice", message: "Downloading voice…", ms: 0 });
  assert.equal(env.document.querySelector("svgp-toast").text, "Downloading voice…");
  env.window.dispatch("gamepadconnected", { gamepad: { id: "Xbox" } });
  assert.deepEqual(env.console.log.calls.at(-1), ["[Street View Gamepad]", "connected:", "Xbox"]);
});
