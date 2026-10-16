// A real DOM (happy-dom) for the parts that build or inspect markup. happy-dom
// does no layout, so tests give elements their boxes with setRect().
import { Window } from "happy-dom";

const windows = [];

/** @param {string} [url] */
export function makeDom(url = "https://www.google.com/maps/@52.5,13.4,15z", { width = 1000, height = 800 } = {}) {
  const window = new Window({ url, width, height });
  windows.push(window);
  return { window, document: window.document };
}

/** Closes the happy-dom windows of a test file. */
export async function closeDoms() {
  for (const w of windows.splice(0)) await w.happyDOM.close();
}

export const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
});

/** @param {Element} el */
export function setRect(el, left, top, width, height) {
  const r = rect(left, top, width, height);
  el.getBoundingClientRect = () => r;
  return el;
}

/** getComputedStyle answering like Chrome for an unstyled element, with overrides per element. */
export function computedStyle(overrides = new Map()) {
  return (el) => ({
    color: "black",
    backgroundColor: "rgba(0, 0, 0, 0)",
    fontWeight: "400",
    backgroundImage: "none",
    borderStyle: "none",
    boxShadow: "none",
    ...overrides.get(el),
  });
}

const RECORDED = [
  "keydown",
  "keyup",
  "pointerdown",
  "pointermove",
  "pointerup",
  "mousedown",
  "mousemove",
  "mouseup",
  "click",
  "wheel",
];

/** Records the input events dispatched on each target (not ones bubbling through it). */
export function recordEvents(...targets) {
  const seen = [];
  for (const t of targets) {
    for (const type of RECORDED) {
      t.addEventListener(
        type,
        (ev) => {
          if (ev.target === t || (t.nodeType === 9 && ev.target === t)) seen.push({ target: t, ev });
        },
        true,
      );
    }
  }
  return {
    seen,
    of: (type, target) => seen.filter((s) => s.ev.type === type && (!target || s.target === target)).map((s) => s.ev),
  };
}

/** The window's event classes. happy-dom's WheelEvent drops clientX/clientY from its init, so keep them. */
export function eventClasses(window) {
  class WheelEvent extends window.WheelEvent {
    constructor(type, init = {}) {
      super(type, init);
      for (const k of ["clientX", "clientY"]) Object.defineProperty(this, k, { value: init[k] ?? 0 });
    }
  }
  return {
    KeyboardEvent: window.KeyboardEvent,
    PointerEvent: window.PointerEvent,
    MouseEvent: window.MouseEvent,
    WheelEvent,
  };
}
