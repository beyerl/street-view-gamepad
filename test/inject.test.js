const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  loadScripts, plain, flush, spy, makeClock, makeWindow, textResponse, errorResponse,
} = require("./helpers/env");
const { FakeElement, makeDocument, eventClasses, makeGamepad } = require("./helpers/dom");

const MAP_URL = "https://www.google.com/maps/@52.5,13.4,15z";
const SV_URL = "https://www.google.com/maps/@52.5,13.4,3a,75y,90h,90t";
const PANO_URL = `${SV_URL}/data=!3m6!1e1!3m4!1sPANO1!2e0!7i16384!8i8192`;
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

// Button indexes of the default mapping.
const B = { forward: 3, back: 0, zoomOut: 4, zoomIn: 5, lookUp: 12, lookDown: 13, lookLeft: 14, lookRight: 15,
  mode: 2, action: 1, fullscreen: 9, overlay: 8 };

function setup({ href = MAP_URL, pads = [], canvas = true, session = {}, fetchImpl } = {}) {
  const clock = makeClock();
  const window = makeWindow();
  const document = makeDocument();
  document.hidden = false;

  const scene = new FakeElement("canvas");
  scene.rect = rect(0, 0, 800, 600);
  if (canvas) document.when(/canvas\.widget-scene-canvas/, [scene]);

  const location = { href, origin: "https://www.google.com", search: "", assign: spy() };
  const store = new Map(Object.entries(session));
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  const state = { pads };
  const fetch = spy(fetchImpl || (async () => { throw new Error("unexpected fetch"); }));
  const console = { log: spy(), warn: spy(), error: spy() };
  const getComputedStyle = (el) => ({
    color: "black", backgroundColor: "rgba(0, 0, 0, 0)", fontWeight: "400",
    backgroundImage: "none", borderStyle: "none", boxShadow: "none", ...el.computed,
  });

  loadScripts(["inject.js"], {
    window, document, location, sessionStorage, fetch, console, getComputedStyle,
    navigator: { getGamepads: () => state.pads },
    ...eventClasses, ...clock.globals,
  });

  const env = {
    clock, window, document, scene, location, store, state, fetch, console,
    press: (...buttons) => { state.pads = [makeGamepad(buttons)]; },
    release: () => { state.pads = [makeGamepad([])]; },
    // Play a message from the bridge (content script) to the page.
    fromBridge: (msg) => window.message({ source: "sv-gamepad-bridge", ...msg }),
    posted: (type) => window.posted.filter((m) => m.source === "sv-gamepad" && m.type === type).map(plain),
    events: (el, type) => el.events.filter((e) => e.type === type),
    bodyChild: (css) => document.body.children.find((c) => c.style.cssText?.includes(css)),
  };
  env.boxText = () => {
    const box = env.bodyChild("translate(-50%, -50%)");
    return box && box.style.display !== "none" ? box.innerHTML : "";
  };
  env.hintText = () => {
    const hint = env.bodyChild("bottom: 40px");
    return hint && hint.style.display !== "none" ? hint.textContent : "";
  };
  env.hud = () => document.body.children.find((c) => c.id === "svgp-hud");
  env.chip = (mode) => env.hud().children.find((c) => c.getAttribute("data-mode") === mode);
  return env;
}

const near = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

// A reply of the Maps photometa endpoint with one panorama.
const panoReply = (type, id, lat, lng) =>
  textResponse(`)]}'\n${JSON.stringify([null, [null, [type, id], null, null, null, [[null, [[null, null, lat, lng]]]]]])}`);
// Always finds PANO2, about 20 m east of the starting point of PANO_URL.
const eastPano = async () => panoReply(2, "PANO2", 52.5, 13.400295);
const noPano = async () => textResponse(")]}'\n[null,null]");

// --- settings ---------------------------------------------------------------------

test("asks the bridge for the settings when it loads", () => {
  const { window } = setup();
  assert.deepEqual(plain(window.posted[0]), { source: "sv-gamepad", type: "getSettings" });
});

test("settings from the bridge are applied; others are ignored", () => {
  const env = setup({ href: SV_URL });
  env.fromBridge({ type: "settings", settings: { lookSpeedX: 1000 } });
  env.window.message({ source: "sv-gamepad-bridge", type: "settings", settings: { lookSpeedX: 1 } }, {});
  env.window.message({ source: "other", type: "settings", settings: { lookSpeedX: 2 } });
  env.press(B.lookRight);
  env.clock.tick(16);
  near(env.events(env.scene, "pointermove")[0].clientX, 400 - 16);
});

// --- logging ----------------------------------------------------------------------------

test("logs connecting and disconnecting gamepads", () => {
  const env = setup();
  env.window.dispatch("gamepadconnected", { gamepad: { id: "Xbox" } });
  env.window.dispatch("gamepaddisconnected", { gamepad: { id: "Xbox" } });
  assert.deepEqual(env.console.log.calls.map((c) => c.slice(1).join(" ")), ["connected: Xbox", "disconnected: Xbox"]);
});

test("log level off silences everything, debug adds button presses", () => {
  const off = setup();
  off.fromBridge({ type: "settings", settings: { logLevel: "off" } });
  off.window.dispatch("gamepadconnected", { gamepad: { id: "Xbox" } });
  assert.equal(off.console.log.calls.length, 0);

  const info = setup({ href: SV_URL });
  info.press(B.forward);
  info.clock.tick(16);
  assert.equal(info.console.log.calls.length, 0); // the default level hides the debug lines

  const debug = setup({ href: SV_URL });
  debug.fromBridge({ type: "settings", settings: { logLevel: "debug" } });
  debug.press(B.back);
  debug.clock.tick(16);
  const lines = debug.console.log.calls.map((c) => c.slice(1).join(" "));
  assert.ok(lines.includes("pad 0: [0]  canvas=true"), lines.join("\n"));
  assert.ok(lines.some((l) => l.startsWith("Street View:")));
});

// --- ambient sound ----------------------------------------------------------------------

test("reports the position from the URL once per ~10 m", () => {
  const env = setup({ href: "https://www.google.com/maps/@52.5,13.4,15z" });
  assert.deepEqual(env.posted("ambient"), [{ source: "sv-gamepad", type: "ambient", lat: 52.5, lng: 13.4 }]);

  env.clock.tick(3000);
  assert.equal(env.posted("ambient").length, 1);

  env.location.href = "https://www.google.com/maps/@52.500001,13.400001,15z"; // a few cm
  env.clock.tick(1000);
  assert.equal(env.posted("ambient").length, 1);

  env.location.href = "https://www.google.com/maps/@52.6,13.4,15z";
  env.clock.tick(1000);
  assert.deepEqual(env.posted("ambient")[1].lat, 52.6);
});

test("without a position, or with sound off, it stops the sound once", () => {
  const noPosition = setup({ href: "https://www.google.com/maps" });
  assert.equal(noPosition.posted("ambientStop").length, 1);
  assert.equal(noPosition.posted("ambient").length, 0);
  noPosition.clock.tick(5000);
  assert.equal(noPosition.posted("ambientStop").length, 1);

  const off = setup();
  off.fromBridge({ type: "settings", settings: { soundEnabled: false } });
  off.clock.tick(1000);
  assert.equal(off.posted("ambientStop").length, 1);
  off.clock.tick(5000);
  assert.equal(off.posted("ambientStop").length, 1);
});

test("a hidden tab stops the sound and a visible one starts it again", () => {
  const env = setup();
  env.document.hidden = true;
  env.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(env.posted("ambientStop").length, 1);
  assert.equal(env.posted("commentaryPause").length, 1);

  env.document.hidden = false;
  env.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(env.posted("ambient").length, 2);
});

// --- keys in Street View ----------------------------------------------------------------

test("walk and zoom buttons press the arrow and +/- keys on the scene", () => {
  const cases = [
    [B.forward, "ArrowUp", 38], [B.back, "ArrowDown", 40], [B.zoomIn, "+", 187], [B.zoomOut, "-", 189],
  ];
  for (const [button, key, keyCode] of cases) {
    const env = setup({ href: SV_URL });
    env.press(button);
    env.clock.tick(16);
    const [down] = env.events(env.scene, "keydown");
    assert.equal(down.key, key);
    assert.equal(down.keyCode, keyCode);
    assert.equal(down.which, keyCode);
    assert.equal(down.repeat, false);
    assert.equal(down.bubbles, true);

    env.release();
    env.clock.tick(16);
    assert.equal(env.events(env.scene, "keyup")[0].key, key);
  }
});

test("a held button repeats after a delay", () => {
  const env = setup({ href: SV_URL });
  env.press(B.forward);
  env.clock.tick(16);
  env.clock.tick(300); // 316 ms: still within the repeat delay
  assert.equal(env.events(env.scene, "keydown").length, 1);

  env.clock.tick(100); // past 350 ms
  const downs = env.events(env.scene, "keydown");
  assert.equal(downs.length, 2);
  assert.equal(downs[1].repeat, true);

  env.clock.tick(240); // two more intervals of 120 ms
  assert.equal(env.events(env.scene, "keydown").length, 4);
  assert.equal(env.events(env.scene, "keyup").length, 0);
});

test("keys go to the page body when there is no scene canvas", () => {
  const env = setup({ href: SV_URL, canvas: false });
  env.press(B.forward);
  env.clock.tick(16);
  assert.equal(env.events(env.document.body, "keydown").length, 1);
});

test("without the known scene canvas the biggest canvas is used", () => {
  const env = setup({ href: SV_URL, canvas: false });
  const small = new FakeElement("canvas");
  const big = new FakeElement("canvas");
  Object.assign(small, { width: 10, height: 10 });
  Object.assign(big, { width: 800, height: 600 });
  env.document.when(/^canvas$/, [small, big]);
  env.press(B.forward);
  env.clock.tick(16);
  assert.equal(env.events(big, "keydown").length, 1);
  assert.equal(env.events(small, "keydown").length, 0);
});

test("remapped and unassigned buttons", () => {
  const env = setup({ href: SV_URL });
  env.fromBridge({ type: "settings", settings: { buttonMap: { forward: 7, back: null } } });
  env.press(B.forward, B.back); // no longer assigned
  env.clock.tick(16);
  assert.equal(env.events(env.scene, "keydown").length, 0);
  env.press(7);
  env.clock.tick(16);
  assert.equal(env.events(env.scene, "keydown")[0].key, "ArrowUp");
});

test("buttons that are not held any more, a missing gamepad or a hidden tab release the keys", () => {
  for (const release of [
    (env) => { env.state.pads = []; },
    (env) => { env.document.hidden = true; },
  ]) {
    const env = setup({ href: SV_URL });
    env.press(B.forward);
    env.clock.tick(16);
    release(env);
    env.clock.tick(16);
    assert.equal(env.events(env.scene, "keyup").length, 1);
  }
});

test("nothing happens while the tab is hidden", () => {
  const env = setup({ href: SV_URL });
  env.document.hidden = true;
  env.press(B.forward, B.fullscreen);
  env.clock.tick(100);
  assert.equal(env.events(env.scene, "keydown").length, 0);
  assert.equal(env.posted("toggleFullscreen").length, 0);
});

// --- looking around / panning -----------------------------------------------------------

test("a look button drags the scene opposite to the look direction", () => {
  const env = setup({ href: SV_URL });
  env.press(B.lookRight);
  env.clock.tick(16);
  const [down] = env.events(env.scene, "pointerdown");
  assert.equal(down.clientX, 400);
  assert.equal(down.clientY, 300);
  assert.equal(down.buttons, 1);
  assert.equal(env.events(env.scene, "mousedown").length, 1);

  const [move] = env.events(env.scene, "pointermove");
  near(move.clientX, 400 - 720 * 0.016);
  near(move.clientY, 300);
  near(env.events(env.document, "mousemove")[0].clientX, 400 - 720 * 0.016);

  env.release();
  env.clock.tick(16);
  const [up] = env.events(env.scene, "pointerup");
  near(up.clientX, 400 - 720 * 0.016);
  assert.equal(up.buttons, 0);
  assert.equal(env.events(env.document, "mouseup").length, 1);
});

test("each look direction moves the cursor the right way", () => {
  const cases = [
    [B.lookLeft, "clientX", 400 + 720 * 0.016],
    [B.lookUp, "clientY", 300 + 480 * 0.016],
    [B.lookDown, "clientY", 300 - 480 * 0.016],
  ];
  for (const [button, axis, expected] of cases) {
    const env = setup({ href: SV_URL });
    env.press(button);
    env.clock.tick(16);
    near(env.events(env.scene, "pointermove")[0][axis], expected);
  }
});

test("a long look re-anchors the drag so the cursor stays on the scene", () => {
  const env = setup({ href: SV_URL });
  env.press(B.lookRight);
  env.clock.tick(16 * 30);
  assert.ok(env.events(env.scene, "pointerup").length >= 1);
  assert.ok(env.events(env.scene, "pointerdown").length >= 2);
});

test("looking does nothing without a scene canvas", () => {
  const env = setup({ href: SV_URL, canvas: false });
  env.press(B.lookRight);
  env.clock.tick(100);
  assert.equal(env.events(env.document, "mousemove").length, 0);
});

// --- the normal map ---------------------------------------------------------------------

test("on the map, forward and back pan by dragging", () => {
  const env = setup();
  env.press(B.forward);
  env.clock.tick(16);
  assert.equal(env.events(env.scene, "keydown").length, 0);
  near(env.events(env.scene, "pointermove")[0].clientY, 300 + 480 * 0.016);

  const down = setup();
  down.press(B.back);
  down.clock.tick(16);
  near(down.events(down.scene, "pointermove")[0].clientY, 300 - 480 * 0.016);
});

test("on the map, zoom buttons scroll the wheel", () => {
  const env = setup();
  env.press(B.zoomIn);
  env.clock.tick(16);
  const [wheel] = env.events(env.scene, "wheel");
  assert.equal(wheel.deltaY, -100);
  assert.equal(wheel.clientX, 400);
  assert.equal(wheel.clientY, 300);

  const out = setup();
  out.press(B.zoomOut);
  out.clock.tick(16);
  assert.equal(out.events(out.scene, "wheel")[0].deltaY, 100);
});

test("recognises Street View by the 3a part or by a panorama id", () => {
  const withPart = setup({ href: SV_URL });
  withPart.press(B.forward);
  withPart.clock.tick(16);
  assert.equal(withPart.events(withPart.scene, "keydown").length, 1);

  // Indoor panoramas with several floors don't always carry the 3a part.
  const withId = setup({ href: "https://www.google.com/maps/@52.5,13.4,17z/data=!3m1!1sPANO!2e0" });
  withId.press(B.forward);
  withId.clock.tick(16);
  assert.equal(withId.events(withId.scene, "keydown").length, 1);

  // !1e1 alone is the map's Street View coverage layer.
  const coverage = setup({ href: "https://www.google.com/maps/@52.5,13.4,17z/data=!5m1!1e1" });
  coverage.press(B.forward);
  coverage.clock.tick(16);
  assert.equal(coverage.events(coverage.scene, "keydown").length, 0);
});

// --- fullscreen -------------------------------------------------------------------------

test("the fullscreen button asks for fullscreen once per press", () => {
  const env = setup();
  env.press(B.fullscreen);
  env.clock.tick(160);
  assert.equal(env.posted("toggleFullscreen").length, 1);
  env.release();
  env.clock.tick(16);
  env.press(B.fullscreen);
  env.clock.tick(16);
  assert.equal(env.posted("toggleFullscreen").length, 2);
});

// --- search bar overlay -----------------------------------------------------------------

function overlayDom(env) {
  const layer = new FakeElement("div");
  layer.rect = rect(0, 0, 1000, 800);
  const panel = new FakeElement("div"); // top-left: the search box and title card
  panel.rect = rect(10, 10, 290, 190);
  const input = new FakeElement("input");
  const side = new FakeElement("div"); // bottom-right: stays
  side.rect = rect(600, 600, 300, 100);
  layer.appendChild(panel);
  layer.appendChild(side);
  panel.appendChild(input);
  env.document.when(/#searchboxinput/, [input]);
  env.document.when(/data-svgp-hidden/, [panel, side]);
  return { panel, side };
}

test("the overlay button hides and shows the search bar and title card", () => {
  const env = setup();
  const { panel, side } = overlayDom(env);

  env.press(B.overlay);
  env.clock.tick(16);
  assert.equal(panel.hasAttribute("data-svgp-hidden"), true);
  assert.equal(side.hasAttribute("data-svgp-hidden"), false);
  assert.equal(env.store.get("svgp-overlay-hidden"), "1");

  env.release();
  env.clock.tick(16);
  env.press(B.overlay);
  env.clock.tick(16);
  assert.equal(panel.hasAttribute("data-svgp-hidden"), false);
  assert.equal(env.store.get("svgp-overlay-hidden"), "");
});

test("a hidden overlay is hidden again after the page re-renders it, and after a reload", () => {
  const env = setup({ session: { "svgp-overlay-hidden": "1" } });
  const { panel } = overlayDom(env);
  env.clock.tick(500);
  assert.equal(panel.hasAttribute("data-svgp-hidden"), true);
  panel.removeAttribute("data-svgp-hidden"); // Maps renders a new card
  env.clock.tick(500);
  assert.equal(panel.hasAttribute("data-svgp-hidden"), true);
});

// --- modes and commentary ---------------------------------------------------------------

test("the mode button switches between levels and commentary and remembers it for the tab", () => {
  const env = setup();
  env.press(B.mode);
  env.clock.tick(16);
  assert.equal(env.store.get("svgp-mode"), "commentary");
  env.release();
  env.clock.tick(16);
  env.press(B.mode);
  env.clock.tick(16);
  assert.equal(env.store.get("svgp-mode"), "levels");
});

test("a mode saved for the tab is restored", () => {
  const env = setup({ session: { "svgp-mode": "commentary" } });
  env.press(B.action);
  env.clock.tick(16);
  assert.equal(env.boxText(), "No commentary for this place.");
});

test("entering commentary mode looks up the place, then again after moving 50 m", () => {
  const env = setup();
  env.press(B.mode);
  env.clock.tick(16);
  assert.deepEqual(env.posted("commentaryAt"), [{ source: "sv-gamepad", type: "commentaryAt", lat: 52.5, lng: 13.4 }]);

  env.location.href = "https://www.google.com/maps/@52.50020,13.4,15z"; // 22 m
  env.clock.tick(2000);
  assert.equal(env.posted("commentaryAt").length, 1);

  env.location.href = "https://www.google.com/maps/@52.5009,13.4,15z"; // 100 m
  env.clock.tick(1000);
  assert.equal(env.posted("commentaryAt").length, 2);
});

test("no lookup in levels mode or in a hidden tab", () => {
  const env = setup();
  env.clock.tick(3000);
  assert.equal(env.posted("commentaryAt").length, 0);

  env.press(B.mode);
  env.clock.tick(16);
  assert.equal(env.posted("commentaryAt").length, 1);

  env.document.hidden = true;
  env.location.href = "https://www.google.com/maps/@53.5,13.4,15z";
  env.clock.tick(3000);
  assert.equal(env.posted("commentaryAt").length, 1);
});

test("the action button in commentary mode toggles the commentary when there is one", () => {
  const env = setup({ session: { "svgp-mode": "commentary" } });
  env.press(B.action);
  env.clock.tick(16);
  assert.equal(env.posted("commentaryToggle").length, 0);
  env.clock.tick(1500);
  assert.equal(env.boxText(), ""); // the message goes away by itself

  env.fromBridge({ type: "commentary", state: { available: true, title: "T", status: "stopped", playingTitle: "" } });
  env.release();
  env.clock.tick(16);
  env.press(B.action);
  env.clock.tick(16);
  assert.equal(env.posted("commentaryToggle").length, 1);
});

test("a playing commentary can be toggled even if nothing new is nearby", () => {
  const env = setup({ session: { "svgp-mode": "commentary" } });
  env.fromBridge({ type: "commentary", state: { available: false, title: "", status: "playing", playingTitle: "X" } });
  env.press(B.action);
  env.clock.tick(16);
  assert.equal(env.posted("commentaryToggle").length, 1);
});

test("notices from the background are shown in the message box and can be cleared", () => {
  const env = setup();
  env.fromBridge({ type: "commentaryNotice", message: "Downloading voice 50%…", ms: 0 });
  assert.equal(env.boxText(), "Downloading voice 50%…");
  env.fromBridge({ type: "commentaryNotice", message: "" });
  assert.equal(env.boxText(), "");

  env.fromBridge({ type: "commentaryNotice", message: "Oops", ms: 6000 });
  env.clock.tick(5000);
  assert.equal(env.boxText(), "Oops");
  env.clock.tick(1500);
  assert.equal(env.boxText(), "");
});

// --- map levels -------------------------------------------------------------------------

function floorPicker(env, labels, { checked, y0 = 300 } = {}) {
  const buttons = labels.map((label, i) => {
    const b = new FakeElement("button");
    b.textContent = label;
    b.rect = rect(900, y0 + i * 40, 40, 30);
    new FakeElement("div").appendChild(b);
    if (label === checked) b.setAttribute("aria-checked", "true");
    return b;
  });
  env.document.when(/role="button"/, buttons);
  return buttons;
}
const clicked = (el) => el.events.map((e) => e.type);

test("the action button without a floor picker says so", () => {
  const env = setup();
  env.press(B.action);
  env.clock.tick(16);
  assert.equal(env.boxText(), "No floors to switch between here.");
});

test("the action button goes one floor up", () => {
  const env = setup();
  const [f3, f2, f1] = floorPicker(env, ["3", "2", "1"], { checked: "2" });
  env.press(B.action);
  env.clock.tick(16);
  assert.deepEqual(clicked(f3), ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  assert.equal(f2.events.length + f1.events.length, 0);
  assert.equal(f3.events.at(-1).clientX, 920);
});

test("from the top floor, or an unknown one, it starts at the bottom", () => {
  const top = setup();
  const [, , topBottom] = floorPicker(top, ["3", "2", "1"], { checked: "3" });
  top.press(B.action);
  top.clock.tick(16);
  assert.equal(topBottom.events.at(-1).type, "click");

  const unknown = setup();
  const [, unknownBottom] = floorPicker(unknown, ["2", "1"]);
  unknown.press(B.action);
  unknown.clock.tick(16);
  assert.equal(unknownBottom.events.at(-1).type, "click");
});

test("the current floor can be told by its different style, or by the last switch", () => {
  const styled = setup();
  const [top, middle] = floorPicker(styled, ["2", "1", "B1"]);
  middle.computed = { fontWeight: "700" }; // the middle one stands out
  styled.press(B.action);
  styled.clock.tick(16);
  assert.equal(top.events.at(-1).type, "click"); // one up from the middle

  const remembered = setup();
  const [a, b] = floorPicker(remembered, ["2", "1"]);
  remembered.press(B.action);
  remembered.clock.tick(16);
  assert.equal(b.events.at(-1).type, "click"); // unknown: bottom
  remembered.release();
  remembered.clock.tick(16);
  remembered.press(B.action);
  remembered.clock.tick(16);
  assert.equal(a.events.at(-1).type, "click"); // now b is the remembered one: up
});

test("things that are not a floor picker are not taken for one", () => {
  const env = setup();
  const lonely = floorPicker(env, ["2"]);
  assert.equal(lonely.length, 1);
  env.press(B.action);
  env.clock.tick(16);
  assert.equal(env.boxText(), "No floors to switch between here."); // one button is no picker

  const other = setup();
  const [left, other2, three] = floorPicker(other, ["Search", "Menu", "3D"]);
  other.press(B.action);
  other.clock.tick(16);
  assert.equal(left.events.length + other2.events.length + three.events.length, 0);
  assert.equal(other.boxText(), "No floors to switch between here.");

  const hiddenOnes = setup();
  const pair = floorPicker(hiddenOnes, ["2", "1"]);
  for (const p of pair) p.visible = false;
  hiddenOnes.press(B.action);
  hiddenOnes.clock.tick(16);
  assert.equal(hiddenOnes.boxText(), "No floors to switch between here.");

  const leftSide = setup();
  const pair2 = floorPicker(leftSide, ["2", "1"]);
  for (const p of pair2) p.rect = rect(10, p.rect.top, 40, 30);
  leftSide.press(B.action);
  leftSide.clock.tick(16);
  assert.equal(leftSide.boxText(), "No floors to switch between here.");
});

// --- HUD --------------------------------------------------------------------------------

test("the HUD only shows while a gamepad is connected", () => {
  const env = setup();
  env.clock.tick(500);
  assert.equal(env.hud(), undefined);

  env.release();
  env.clock.tick(500);
  assert.equal(env.hud().style.display, "flex");
  env.state.pads = [];
  env.clock.tick(500);
  assert.equal(env.hud().style.display, "none");
});

test("the HUD marks the active mode and describes the floors", () => {
  const env = setup();
  floorPicker(env, ["3", "2", "1"], { checked: "2" });
  env.release();
  env.clock.tick(500);
  assert.ok(env.chip("levels").className.includes("active"));
  assert.equal(env.chip("commentary").className.includes("active"), false);
  assert.ok(env.chip("levels").className.includes("on"));
  assert.equal(env.chip("levels").querySelector("span").textContent, "Floor 2");

  env.press(B.mode);
  env.clock.tick(16);
  assert.ok(env.chip("commentary").className.includes("active"));
});

test("the HUD says when there are no floors", () => {
  const env = setup();
  env.release();
  env.clock.tick(500);
  assert.equal(env.chip("levels").querySelector("span").textContent, "No floors here");
  assert.equal(env.chip("levels").className.includes("on"), false);
});

test("the HUD describes the commentary state", () => {
  const env = setup();
  env.release();
  const label = () => env.chip("commentary").querySelector("span").textContent;
  env.clock.tick(500);
  assert.equal(label(), "Nothing nearby");

  env.fromBridge({ type: "commentary", state: { available: true, title: "Gate", status: "stopped", playingTitle: "" } });
  assert.equal(label(), "Gate");
  assert.ok(env.chip("commentary").className.includes("on"));

  env.fromBridge({ type: "commentary", state: { available: true, title: "Gate", status: "playing", playingTitle: "Tower" } });
  assert.equal(label(), "Tower");
  assert.ok(env.chip("commentary").className.includes("playing"));

  env.fromBridge({ type: "commentary", state: { available: true, title: "Gate", status: "paused", playingTitle: "Tower" } });
  assert.equal(label(), "⏸ Tower");
  assert.equal(env.chip("commentary").className.includes("playing"), false);
});

test("the HUD moves out of the way of Maps' own controls", () => {
  const env = setup();
  env.release();
  env.clock.tick(1000);
  const hud = env.hud();
  hud.rect = rect(0, 0, 100, 40);
  env.clock.tick(1000);
  assert.equal(hud.style.right, "12px");
  assert.equal(hud.style.bottom, "12px");

  const control = new FakeElement("button");
  control.rect = rect(900, 700, 80, 60); // right where the HUD would sit
  env.document.body.appendChild(control);
  env.clock.tick(1000);
  assert.equal(hud.style.right, "12px");
  assert.equal(hud.style.bottom, "106px");
});

// --- jumping to unconnected panoramas ---------------------------------------------------

async function withHint(opts = {}) {
  const env = setup({ href: PANO_URL, fetchImpl: eastPano, ...opts });
  env.clock.tick(250); // the view is seen
  env.clock.tick(400); // and has rested: the lookup starts
  await flush();
  return env;
}

test("shows the distance to the next panorama ahead", async () => {
  const env = await withHint();
  assert.equal(env.fetch.calls.length, 9);
  assert.ok(env.fetch.calls[0][0].startsWith("/maps/photometa/si/v1?pb="));
  assert.equal(env.hintText(), "Next jump point 20 m");
});

test("looks up again only when the view changes", async () => {
  const env = await withHint();
  env.clock.tick(2000);
  await flush();
  assert.equal(env.fetch.calls.length, 9);

  env.location.href = PANO_URL.replace("90h", "180h");
  env.clock.tick(250 + 400);
  await flush();
  assert.equal(env.fetch.calls.length, 18);
  // Panorama 20 m to the east is not ahead when looking south.
  assert.equal(env.hintText(), "No jump point in this direction");
});

test("says so when nothing lies ahead or the lookup fails", async () => {
  const none = await withHint({ fetchImpl: noPano });
  assert.equal(none.hintText(), "No jump point in this direction");

  const failing = await withHint({ fetchImpl: async () => errorResponse(500) });
  assert.equal(failing.hintText(), "No jump point in this direction");
  assert.match(String(failing.console.log.calls[0][1]), /HTTP 500/);
});

test("distances over a kilometre are shown in km", async () => {
  const env = await withHint({ fetchImpl: async () => panoReply(2, "PANO2", 52.5, 13.4 + 0.0295) });
  assert.equal(env.hintText(), "Next jump point 2.0 km");
});

test("the hint goes away outside Street View", async () => {
  const env = await withHint();
  env.location.href = MAP_URL;
  env.clock.tick(250);
  assert.equal(env.hintText(), "");
});

test("a panorama lookup is dropped when the view moved on meanwhile", async () => {
  const env = setup({ href: PANO_URL, fetchImpl: eastPano });
  env.clock.tick(250 + 400);
  env.location.href = MAP_URL; // leaves Street View while the lookup runs
  env.clock.tick(250);
  await flush();
  assert.equal(env.hintText(), "");
});

test("walking into a dead end jumps to the panorama ahead", async () => {
  const env = await withHint();
  env.press(B.forward);
  env.clock.tick(1300);
  assert.deepEqual(env.location.assign.calls, [[
    "https://www.google.com/maps/@52.5,13.400295,3a,75y,90.00h,90t/data=!3m4!1e1!3m2!1sPANO2!2e0",
  ]]);
});

test("a photosphere is opened with its own URL form, keeping the query string", async () => {
  const env = await withHint({ fetchImpl: async () => panoReply(10, "PANO2", 52.5, 13.400295) });
  env.location.search = "?hl=de";
  env.press(B.forward);
  env.clock.tick(1300);
  assert.equal(
    env.location.assign.calls[0][0],
    "https://www.google.com/maps/@52.5,13.400295,3a,75y,90.00h,90t/data=!3m5!1e1!3m3!1sPANO2!2e10!3e11?hl=de",
  );
});

test("when walking moved to another panorama no jump happens", async () => {
  const env = await withHint();
  env.press(B.forward);
  env.clock.tick(16);
  env.location.href = PANO_URL.replace("PANO1", "PANO3"); // walking worked
  env.release();
  env.clock.tick(1500);
  await flush();
  assert.equal(env.location.assign.calls.length, 0);
});

test("walking with nothing ahead says so", async () => {
  const env = await withHint({ fetchImpl: noPano });
  env.press(B.forward);
  env.clock.tick(1300);
  assert.equal(env.boxText(), "No Street View point found in this direction.");
  assert.equal(env.location.assign.calls.length, 0);
  env.clock.tick(2500);
  assert.equal(env.boxText(), "");
});

test("walking backwards searches behind the view", async () => {
  const env = await withHint();
  const before = env.fetch.calls.length;
  env.press(B.back);
  env.clock.tick(1300);
  assert.equal(env.boxText(), "Searching for the next Street View point…");
  await flush();
  assert.equal(env.fetch.calls.length, before + 9);
  assert.equal(env.boxText(), "No Street View point found in this direction."); // the east panorama is ahead, not behind
  assert.equal(env.location.assign.calls.length, 0);
});

test("a panorama search that finishes after the view left is ignored", async () => {
  const env = await withHint();
  env.press(B.back);
  env.clock.tick(1300);
  env.location.href = PANO_URL.replace("PANO1", "PANO3");
  await flush();
  assert.equal(env.boxText(), "");
  assert.equal(env.location.assign.calls.length, 0);
});

test("no jump logic runs when the URL has no panorama id", () => {
  const env = setup({ href: SV_URL });
  env.press(B.forward);
  env.clock.tick(2000);
  assert.equal(env.fetch.calls.length, 0);
  assert.equal(env.location.assign.calls.length, 0);
});
