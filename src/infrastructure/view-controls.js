// How the buttons act on the view (Strategy). Street View takes synthetic key
// presses; the map ignores them until a real key was pressed on the page, so
// there buttons drag and scroll the wheel instead.

import { Action } from "../domain/actions.js";
import { LOOK_REANCHOR, WHEEL_STEP } from "../shared/config.js";
import { ViewControls } from "../ports/index.js";

/** @typedef {{ key: string, code: string, keyCode: number }} KeySpec */

/** @type {Readonly<Record<string, KeySpec>>} */
export const KEYS = Object.freeze({
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  zoomIn: { key: "+", code: "Equal", keyCode: 187 },
  zoomOut: { key: "-", code: "Minus", keyCode: 189 },
});

/** Dispatches synthetic input on the scene canvas. */
export class SceneInput {
  /**
   * @param {{ dom: import("./google-maps-dom.js").GoogleMapsDom, document: Document, window: Window,
   *           events: { KeyboardEvent: typeof KeyboardEvent, PointerEvent: typeof PointerEvent, MouseEvent: typeof MouseEvent } }} deps
   */
  constructor({ dom, document, window, events }) {
    this.dom = dom;
    this.document = document;
    this.window = window;
    this.events = events;
  }

  /** @param {string} type @param {KeySpec} k @param {boolean} [repeat] */
  key(type, k, repeat = false) {
    const target = this.dom.sceneCanvas() || this.document.body;
    const ev = new this.events.KeyboardEvent(type, {
      key: k.key,
      code: k.code,
      repeat,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: this.window,
    });
    // Chrome ignores keyCode/which in the init dict; many handlers still use them.
    Object.defineProperty(ev, "keyCode", { get: () => k.keyCode });
    Object.defineProperty(ev, "which", { get: () => k.keyCode });
    target.dispatchEvent(ev);
  }

  /** @param {"down" | "move" | "up"} kind @param {number} x @param {number} y @param {number} buttons */
  pointer(kind, x, y, buttons) {
    const target = this.dom.sceneCanvas();
    if (!target) return;
    const common = {
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: this.window,
    };
    const pType = { down: "pointerdown", move: "pointermove", up: "pointerup" }[kind];
    const mType = { down: "mousedown", move: "mousemove", up: "mouseup" }[kind];
    target.dispatchEvent(
      new this.events.PointerEvent(pType, { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }),
    );
    // mousemove/mouseup are often listened for on document during a drag.
    (kind === "down" ? target : this.document).dispatchEvent(new this.events.MouseEvent(mType, common));
  }

  /** @param {number} deltaY */
  wheel(deltaY) {
    const target = this.dom.sceneCanvas();
    if (target) this.dom.wheel(target, deltaY);
  }
}

/** Looking around / panning by dragging the scene with a virtual mouse. */
export class DragLook {
  /** @param {SceneInput} input @param {import("./google-maps-dom.js").GoogleMapsDom} dom @param {{ lookSpeedX: number, lookSpeedY: number }} settings */
  constructor(input, dom, settings) {
    this.input = input;
    this.dom = dom;
    this.settings = settings;
    /** @type {{ x: number, y: number, ox: number, oy: number } | null} */
    this.drag = null;
  }

  /** @param {number} dx @param {number} dy @param {number} dt */
  update(dx, dy, dt) {
    if (!dx && !dy) {
      this.release();
      return;
    }
    const canvas = this.dom.sceneCanvas();
    if (!canvas) return;
    if (!this.drag) {
      const r = canvas.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      this.drag = { x, y, ox: x, oy: y };
      this.input.pointer("down", x, y, 1);
    }
    const d = this.drag;
    // Dragging moves the scene with the cursor, so drag opposite to the look direction.
    d.x -= (dx * this.settings.lookSpeedX * dt) / 1000;
    d.y -= (dy * this.settings.lookSpeedY * dt) / 1000;
    this.input.pointer("move", d.x, d.y, 1);
    // Keep the virtual cursor near the centre so it never leaves the canvas.
    if (Math.hypot(d.x - d.ox, d.y - d.oy) > LOOK_REANCHOR) this.release();
  }

  release() {
    if (!this.drag) return;
    this.input.pointer("up", this.drag.x, this.drag.y, 0);
    this.drag = null;
  }
}

/** @param {SceneInput} input @param {KeySpec} k */
const keyAction = (input, k) => ({
  down: (/** @type {boolean} */ repeat) => input.key("keydown", k, repeat),
  up: () => input.key("keyup", k),
});
/** @param {(deltaY: number) => void} wheel @param {number} deltaY */
const wheelAction = (wheel, deltaY) => ({ down: () => wheel(deltaY), up: () => {} });

/** Street View: keys walk and zoom, the wheel zooms the minimap. @implements {ViewControls} */
export class StreetViewControls extends ViewControls {
  /** @param {SceneInput} input @param {DragLook} look @param {import("./google-maps-dom.js").GoogleMapsDom} dom */
  constructor(input, look, dom) {
    super();
    this.lookControl = look;
    const minimapWheel = (/** @type {number} */ deltaY) => {
      const map = dom.minimap();
      if (map) dom.wheel(map, deltaY);
    };
    this.actions = {
      [Action.FORWARD]: keyAction(input, KEYS.up),
      [Action.BACK]: keyAction(input, KEYS.down),
      [Action.ZOOM_IN]: keyAction(input, KEYS.zoomIn),
      [Action.ZOOM_OUT]: keyAction(input, KEYS.zoomOut),
      [Action.MINIMAP_ZOOM_IN]: wheelAction(minimapWheel, -WHEEL_STEP),
      [Action.MINIMAP_ZOOM_OUT]: wheelAction(minimapWheel, WHEEL_STEP),
    };
  }
  held(/** @type {string} */ action) {
    return this.actions[action] || null;
  }
  look(/** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ dt) {
    this.lookControl.update(dx, dy, dt);
  }
  get walkPans() {
    return false;
  }
}

/** The map: walking pans (see InputController), zoom scrolls the wheel. @implements {ViewControls} */
export class MapControls extends ViewControls {
  /** @param {SceneInput} input @param {DragLook} look */
  constructor(input, look) {
    super();
    this.lookControl = look;
    const wheel = (/** @type {number} */ d) => input.wheel(d);
    this.actions = {
      [Action.ZOOM_IN]: wheelAction(wheel, -WHEEL_STEP),
      [Action.ZOOM_OUT]: wheelAction(wheel, WHEEL_STEP),
    };
  }
  held(/** @type {string} */ action) {
    return this.actions[action] || null;
  }
  look(/** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ dt) {
    this.lookControl.update(dx, dy, dt);
  }
  get walkPans() {
    return true;
  }
}
