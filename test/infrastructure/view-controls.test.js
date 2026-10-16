import { after, test } from "node:test";
import assert from "node:assert/strict";
import { GoogleMapsDom } from "../../src/infrastructure/google-maps-dom.js";
import { DragLook, MapControls, SceneInput, StreetViewControls } from "../../src/infrastructure/view-controls.js";
import { Action } from "../../src/domain/actions.js";
import { closeDoms, computedStyle, eventClasses, makeDom, recordEvents, setRect } from "../helpers/dom.js";

after(closeDoms);

function setup({ withScene = true } = {}) {
  const { window, document } = makeDom();
  const dom = new GoogleMapsDom({
    document,
    window,
    getComputedStyle: computedStyle(),
    events: eventClasses(window),
    log: () => {},
  });
  const scene = document.createElement("canvas");
  if (withScene) {
    scene.className = "widget-scene-canvas";
    document.body.appendChild(scene);
    setRect(scene, 0, 0, 800, 600);
  }
  const settings = { lookSpeedX: 720, lookSpeedY: 480 };
  const input = new SceneInput({ dom, document, window, events: eventClasses(window) });
  const look = new DragLook(input, dom, settings);
  const rec = recordEvents(scene, document, document.body);
  return {
    window,
    document,
    dom,
    scene,
    input,
    look,
    settings,
    rec,
    sv: new StreetViewControls(input, look, dom),
    map: new MapControls(input, look),
  };
}

test("Street View walks and zooms with keys carrying keyCode and which", () => {
  const env = setup();
  const cases = [
    [Action.FORWARD, "ArrowUp", 38],
    [Action.BACK, "ArrowDown", 40],
    [Action.ZOOM_IN, "+", 187],
    [Action.ZOOM_OUT, "-", 189],
  ];
  for (const [action, key, keyCode] of cases) {
    const a = env.sv.held(action);
    a.down(false);
    a.down(true);
    a.up();
    const [down, repeat] = env.rec.of("keydown", env.scene).slice(-2);
    assert.deepEqual(
      [down.key, down.keyCode, down.which, down.repeat, down.bubbles],
      [key, keyCode, keyCode, false, true],
    );
    assert.equal(repeat.repeat, true);
    assert.equal(env.rec.of("keyup", env.scene).at(-1).key, key);
  }
  assert.equal(env.sv.walkPans, false);
  assert.equal(env.sv.held(Action.MODE), null);
});

test("keys go to the body without a scene", () => {
  const env = setup({ withScene: false });
  env.sv.held(Action.FORWARD).down(false);
  assert.equal(env.rec.of("keydown", env.document.body)[0].key, "ArrowUp");
});

test("the map zooms with the wheel over the scene's centre, and pans when walking", () => {
  const env = setup();
  env.map.held(Action.ZOOM_IN).down(false);
  env.map.held(Action.ZOOM_OUT).down(false);
  env.map.held(Action.ZOOM_OUT).up();
  const wheels = env.rec.of("wheel", env.scene);
  assert.deepEqual(
    wheels.map((w) => [w.deltaY, w.clientX, w.clientY]),
    [
      [-100, 400, 300],
      [100, 400, 300],
    ],
  );
  assert.equal(env.map.held(Action.FORWARD), null);
  assert.equal(env.map.walkPans, true);
});

test("minimap zoom scrolls over the minimap, only if there is one", () => {
  const env = setup();
  env.sv.held(Action.MINIMAP_ZOOM_IN).down(false);
  const map = setRect(env.document.createElement("canvas"), 10, 600, 200, 150);
  env.document.body.appendChild(map);
  const rec = recordEvents(map);
  env.sv.held(Action.MINIMAP_ZOOM_IN).down(false);
  env.sv.held(Action.MINIMAP_ZOOM_OUT).down(false);
  assert.deepEqual(
    rec.of("wheel").map((w) => [w.deltaY, w.clientX, w.clientY]),
    [
      [-100, 110, 675],
      [100, 110, 675],
    ],
  );
});

test("looking drags the scene opposite to the look direction, from its centre", () => {
  const env = setup();
  env.sv.look(1, 0, 16);
  const [down] = env.rec.of("pointerdown", env.scene);
  assert.deepEqual([down.clientX, down.clientY, down.buttons], [400, 300, 1]);
  assert.equal(env.rec.of("mousedown", env.scene).length, 1);
  const move = env.rec.of("pointermove", env.scene)[0];
  assert.ok(Math.abs(move.clientX - (400 - 720 * 0.016)) < 1e-9);
  assert.equal(env.rec.of("mousemove", env.document).length, 1); // drags listen on document
  env.sv.look(0, -1, 16);
  assert.ok(env.rec.of("pointermove", env.scene)[1].clientY > 300);
  env.sv.look(0, 0, 16);
  assert.equal(env.rec.of("pointerup", env.scene).length, 1);
  assert.equal(env.rec.of("mouseup", env.document).length, 1);
  env.sv.look(0, 0, 16);
  assert.equal(env.rec.of("pointerup", env.scene).length, 1);
});

test("a long look re-anchors so the cursor stays on the scene; speed comes from the settings", () => {
  const env = setup();
  env.settings.lookSpeedX = 10000;
  env.sv.look(1, 0, 30); // 300 px: past the re-anchor distance
  assert.equal(env.rec.of("pointerup", env.scene).length, 1);
  env.sv.look(1, 0, 10);
  assert.equal(env.rec.of("pointerdown", env.scene).at(-1).clientX, 400);
});

test("no scene, no looking", () => {
  const env = setup({ withScene: false });
  env.map.look(1, 1, 16);
  assert.equal(env.rec.seen.length, 0);
});
