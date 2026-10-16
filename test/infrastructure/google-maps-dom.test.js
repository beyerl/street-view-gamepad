import { after, test } from "node:test";
import assert from "node:assert/strict";
import { GoogleMapsDom } from "../../src/infrastructure/google-maps-dom.js";
import { closeDoms, computedStyle, eventClasses, makeDom, recordEvents, setRect } from "../helpers/dom.js";
import { spy } from "../helpers/fakes.js";

after(closeDoms);

function setup({ styles = new Map() } = {}) {
  const { window, document } = makeDom();
  const log = spy();
  const dom = new GoogleMapsDom({
    document,
    window,
    getComputedStyle: computedStyle(styles),
    events: eventClasses(window),
    log,
  });
  const el = (tag, parent = document.body, attrs = {}) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.appendChild(e);
    return e;
  };
  return { window, document, dom, el, log, styles };
}

test("adds the stylesheet that hides overlay panels", () => {
  const { document } = setup();
  assert.match(
    document.documentElement.lastElementChild.textContent,
    /\[data-svgp-hidden\] \{ visibility: hidden !important/,
  );
});

test("the scene is the known canvas, or else the biggest one", () => {
  const { document, dom, el } = setup();
  const small = el("canvas");
  const big = el("canvas");
  small.width = small.height = 10;
  big.width = 800;
  big.height = 600;
  assert.equal(dom.sceneCanvas(), big);
  const known = el("canvas");
  known.className = "widget-scene-canvas";
  assert.equal(dom.sceneCanvas(), known);
  document.body.textContent = "";
  assert.equal(dom.sceneCanvas(), undefined);
});

test("hides the floating panels in the top-left quarter of the search box's layer, and shows them again", () => {
  const { dom, el } = setup();
  const layer = setRect(el("div"), 0, 0, 1000, 800);
  const card = setRect(el("div", layer), 10, 10, 300, 200);
  const search = setRect(el("input", card, { id: "searchboxinput" }), 20, 20, 200, 30);
  const deep = setRect(el("div", layer), 0, 0, 1000, 800); // too big itself: look inside
  const inner = setRect(el("div", deep), 400, 300, 50, 50);
  const right = setRect(el("div", deep), 600, 10, 100, 100);
  const withScene = setRect(el("div", layer), 0, 0, 100, 100);
  el("canvas", withScene);
  void search;
  dom.setOverlayHidden(true);
  assert.deepEqual(
    [card, inner, right, withScene].map((e) => e.hasAttribute("data-svgp-hidden")),
    [true, true, false, false],
  );
  dom.setOverlayHidden(false);
  assert.equal(card.hasAttribute("data-svgp-hidden"), false);
});

test("without a search box there is nothing to hide", () => {
  const { dom, el } = setup();
  const card = setRect(el("div"), 10, 10, 100, 100);
  dom.setOverlayHidden(true);
  assert.equal(card.hasAttribute("data-svgp-hidden"), false);
});

/** Floor buttons stacked in the right half, top first. */
function floors(env, labels, { checked, x = 900 } = {}) {
  return labels.map((label, i) => {
    const b = setRect(env.el("button"), x, 300 + i * 40, 40, 30);
    b.textContent = label;
    if (label === checked) b.setAttribute("aria-checked", "true");
    return b;
  });
}

test("finds the floor picker by shape, top floor first, with the marked current floor", () => {
  const env = setup();
  const [f3, f2, f1] = floors(env, ["3", "2", "1"], { checked: "2" });
  const p = env.dom.findLevelPicker();
  assert.deepEqual(
    p.items.map((i) => i.el),
    [f3, f2, f1],
  );
  assert.equal(p.current, 1);
});

test("the current floor: marked on a parent or child, by its odd style, or the last switch", () => {
  const parent = setup();
  const [a, b] = floors(parent, ["2", "1"]);
  const wrap = parent.document.createElement("div");
  wrap.setAttribute("aria-current", "page");
  b.replaceWith(wrap);
  wrap.appendChild(b);
  assert.equal(parent.dom.findLevelPicker().current, 1);
  void a;

  const child = setup();
  const [, c2] = floors(child, ["2", "1"]);
  const span = child.document.createElement("span");
  span.setAttribute("aria-selected", "true");
  c2.appendChild(span);
  span.textContent = "";
  assert.equal(child.dom.findLevelPicker().current, 1);

  const styled = setup();
  const [, middle] = floors(styled, ["2", "1", "B1"]);
  styled.styles.set(middle, { fontWeight: "700" });
  assert.equal(styled.dom.findLevelPicker().current, 1);

  const remembered = setup();
  floors(remembered, ["2", "1"]);
  assert.equal(remembered.dom.findLevelPicker().current, -1);
  remembered.dom.lastLevel = "1";
  assert.equal(remembered.dom.findLevelPicker().current, 1);
});

test("things that are not a floor picker are not taken for one", () => {
  const lonely = setup();
  floors(lonely, ["2"]);
  assert.equal(lonely.dom.findLevelPicker(), null);
  const words = setup();
  floors(words, ["Search", "Menu", "3D"]);
  assert.equal(words.dom.findLevelPicker(), null);
  const left = setup();
  floors(left, ["2", "1"], { x: 10 });
  assert.equal(left.dom.findLevelPicker(), null);
  const hidden = setup();
  for (const b of floors(hidden, ["2", "1"])) b.style.visibility = "hidden";
  assert.equal(hidden.dom.findLevelPicker(), null);
  const own = setup();
  const mine = floors(own, ["2", "1"]);
  own.dom.ownElements.add(mine[0]);
  assert.equal(own.dom.findLevelPicker(), null);
});

function minimapSetup() {
  const env = setup();
  const scene = env.el("canvas");
  scene.className = "widget-scene-canvas";
  setRect(scene, 0, 0, 1000, 800);
  const map = setRect(env.el("canvas"), 10, 600, 200, 150);
  return { ...env, scene, map };
}

test("the minimap is a canvas other than the scene in the lower left", () => {
  const env = minimapSetup();
  assert.equal(env.dom.minimap(), env.map);
  setRect(env.map, 600, 600, 200, 150);
  assert.equal(env.dom.minimap(), null);
});

test("the minimap's size button: by label first, else the one in its upper right corner", () => {
  const env = minimapSetup();
  const corner = setRect(env.el("button"), 185, 602, 20, 20);
  const middle = setRect(env.el("button"), 100, 680, 20, 20);
  setRect(env.el("button"), 500, 100, 20, 20); // not on the minimap
  assert.equal(env.dom.minimapSizeButton(env.map), corner);
  const labelled = setRect(
    env.el("div", env.document.body, { role: "button", "aria-label": "Karte vergrößern" }),
    20,
    610,
    20,
    20,
  );
  assert.equal(env.dom.minimapSizeButton(env.map), labelled);
  assert.match(env.log.calls.at(-1).join(" "), /minimap buttons:/);
  void middle;
  const empty = minimapSetup();
  assert.equal(empty.dom.minimapSizeButton(empty.map), null);
});

test("clicks are full mouse clicks in the middle; wheel notches too", () => {
  const env = setup();
  const b = setRect(env.el("button"), 900, 300, 40, 30);
  const rec = recordEvents(b);
  env.dom.click(b);
  assert.deepEqual(
    rec.seen.map((s) => s.ev.type),
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"],
  );
  assert.equal(rec.seen[4].ev.clientX, 920);
  env.dom.wheel(b, -100);
  const w = rec.of("wheel")[0];
  assert.deepEqual([w.deltaY, w.clientX, w.clientY], [-100, 920, 315]);
});

test("obstacles: Maps' controls lower right, not big layers, empty boxes or our own UI", () => {
  const env = setup();
  const zoom = setRect(env.el("button"), 940, 650, 40, 80);
  const text = setRect(env.el("div"), 800, 770, 150, 20);
  text.textContent = "© Google";
  const painted = setRect(env.el("div"), 700, 700, 30, 30);
  env.styles.set(painted, { backgroundColor: "white" });
  setRect(env.el("div"), 700, 600, 30, 30); // paints nothing
  setRect(env.el("canvas"), 0, 0, 1000, 800); // the scene
  setRect(env.el("button"), 10, 700, 40, 40); // left third
  setRect(env.el("button"), 900, 10, 40, 40); // top half
  const mine = setRect(env.el("button"), 900, 700, 40, 40);
  env.dom.ownElements.add(mine);
  const tops = env.dom.obstacles().map((r) => r.top);
  assert.deepEqual(tops.sort(), [zoom, text, painted].map((e) => e.getBoundingClientRect().top).sort());
});
