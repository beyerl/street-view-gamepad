// Google Maps' own page. Its markup is obfuscated and changes, so everything
// here finds things by shape and position rather than by class name. When
// Google changes the page, this is the file to fix.

import { isLevelLabel } from "../domain/levels.js";
import { MapsPage } from "../ports/index.js";

const HIDE_ATTR = "data-svgp-hidden";
const LEVEL_SEL = 'button, [role="button"], [role="radio"], [role="option"], [role="menuitemradio"], [role="tab"]';
const SELECTED_ATTRS = ["aria-checked", "aria-pressed", "aria-selected"];
const MINIMAP_SIZE_RE =
  /expand|collapse|enlarge|shrink|maximi|minimi|vergr|verklein|erweiter|einklapp|ausklapp|agrandir|réduire|ampliar|reducir/i;
const LABEL_ATTRS = ["aria-label", "title", "data-tooltip"];
const COLUMN_TOLERANCE = 8; // px the centres of a floor picker's buttons may differ
const OVERLAY_DEPTH = 6; // how deep to look for top-left panels
const OVERLAY_LAYER_WIDTH = 0.9; // of the window: the full-page layer holding the search box
const MIN_STYLED_LEVELS = 3; // to tell the current floor by its odd style
const OBSTACLE_LEFT = 1 / 3; // eslint-disable-line no-magic-numbers -- of the width: Maps' controls we avoid are right of this
const OBSTACLE_MAX_AREA = 1 / 4; // eslint-disable-line no-magic-numbers -- of the window: bigger elements are layers, not controls

/** @implements {MapsPage} */
export class GoogleMapsDom extends MapsPage {
  /**
   * @param {{ document: Document, window: Window, getComputedStyle: typeof globalThis.getComputedStyle,
   *           events: { PointerEvent: typeof PointerEvent, MouseEvent: typeof MouseEvent, WheelEvent: typeof WheelEvent },
   *           log: (level: string, ...args: any[]) => void }} deps
   */
  constructor({ document, window, getComputedStyle, events, log }) {
    super();
    this.document = document;
    this.window = window;
    this.getComputedStyle = getComputedStyle;
    this.events = events;
    this.log = log;
    /** Elements of our own UI, never taken for part of Maps. @type {Set<Element>} */
    this.ownElements = new Set();
    /** Label of the floor we last switched to, if the picker doesn't mark the current one. */
    this.lastLevel = "";
    const style = document.createElement("style");
    // !important beats Maps' own inline visibility styles.
    style.textContent = `[${HIDE_ATTR}] { visibility: hidden !important; pointer-events: none !important; }`;
    document.documentElement.appendChild(style);
  }

  /** @param {Element} el */
  isOwn(el) {
    for (const own of this.ownElements) if (own === el || own.contains(el)) return true;
    return false;
  }

  /** @param {Element} el */
  visible(el) {
    return el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  }

  /** The Street View scene or the map: the known canvas, or else the biggest. @returns {HTMLCanvasElement | undefined} */
  sceneCanvas() {
    return (
      this.document.querySelector("canvas.widget-scene-canvas") ||
      [...this.document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0]
    );
  }

  // --- Search bar and title card ------------------------------------------------
  // Within the full-page overlay layer that holds the search input, every
  // floating element that sits entirely in the top-left quarter of the page.

  overlayLayer() {
    let el = this.document.querySelector("#searchboxinput, form input");
    while (el && el.getBoundingClientRect().width < this.window.innerWidth * OVERLAY_LAYER_WIDTH) el = el.parentElement;
    return el;
  }

  /** @param {Element} el @param {number} depth */
  hideTopLeft(el, depth) {
    const r = el.getBoundingClientRect();
    if (
      r.width > 0 &&
      r.height > 0 &&
      r.right <= this.window.innerWidth / 2 &&
      r.bottom <= this.window.innerHeight / 2
    ) {
      el.setAttribute(HIDE_ATTR, "");
      return;
    }
    if (depth < OVERLAY_DEPTH) for (const c of el.children) this.hideTopLeft(c, depth + 1);
  }

  setOverlayHidden(/** @type {boolean} */ hidden) {
    if (!hidden) {
      for (const el of this.document.querySelectorAll(`[${HIDE_ATTR}]`)) el.removeAttribute(HIDE_ATTR);
      return;
    }
    const layer = this.overlayLayer();
    if (!layer) return;
    for (const child of layer.children) if (!child.querySelector("canvas")) this.hideTopLeft(child, 0);
  }

  // --- Floor picker -------------------------------------------------------------
  // A vertical stack of short labels ("B1", "1", "2F", …) in the right half,
  // highest floor on top.

  findLevelPicker() {
    const cands = [];
    for (const el of this.document.querySelectorAll(LEVEL_SEL)) {
      if (this.isOwn(el) || el.querySelector(LEVEL_SEL)) continue; // innermost only
      const label = el.textContent.trim();
      if (!isLevelLabel(label)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.left < this.window.innerWidth / 2 || !this.visible(el)) continue;
      cands.push({ el, label, x: r.left + r.width / 2, y: r.top });
    }
    // Cluster by horizontal centre; the biggest column of 2+ is the picker.
    let best = [];
    for (const c of cands) {
      const col = cands.filter((o) => Math.abs(o.x - c.x) < COLUMN_TOLERANCE);
      if (col.length > best.length) best = col;
    }
    if (best.length < 2) return null;
    const items = best.sort((a, b) => a.y - b.y).map(({ el, label }) => ({ el, label })); // top first
    return { items, current: this.currentLevel(items) };
  }

  /** @param {{ el: Element, label: string }[]} items */
  currentLevel(items) {
    const isOn = (/** @type {Element | null} */ e) =>
      !!e &&
      (SELECTED_ATTRS.some((a) => e.getAttribute(a) === "true") ||
        (e.hasAttribute("aria-current") && e.getAttribute("aria-current") !== "false"));
    const i = items.findIndex(
      ({ el }) => isOn(el) || isOn(el.parentElement) || [...el.querySelectorAll("*")].some(isOn),
    );
    if (i >= 0) return i;
    // Otherwise the selected one is usually the only one styled differently.
    if (items.length >= MIN_STYLED_LEVELS) {
      const sig = items.map(({ el }) => {
        const cs = this.getComputedStyle(el);
        return `${cs.color}|${cs.backgroundColor}|${cs.fontWeight}`;
      });
      const odd = sig.filter((s) => sig.indexOf(s) === sig.lastIndexOf(s));
      if (odd.length === 1) return sig.indexOf(odd[0]);
    }
    return items.findIndex((it) => it.label === this.lastLevel);
  }

  // --- Minimap ------------------------------------------------------------------
  // A map canvas other than the scene, reaching into the lower left quarter.

  minimap() {
    const scene = this.sceneCanvas();
    for (const c of this.document.querySelectorAll("canvas")) {
      if (c === scene) continue;
      const r = c.getBoundingClientRect();
      if (
        r.width &&
        r.height &&
        r.left < this.window.innerWidth / 2 &&
        r.bottom > this.window.innerHeight / 2 &&
        this.visible(c)
      )
        return c;
    }
    return null;
  }

  /** The enlarge / shrink button: by its label, else the button on the minimap
   * closest to its upper right corner, where Maps puts it. @param {Element} map */
  minimapSizeButton(map) {
    const m = map.getBoundingClientRect();
    const buttons = [...this.document.querySelectorAll('button, [role="button"]')].filter((b) => {
      const r = b.getBoundingClientRect();
      return (
        r.width &&
        r.height &&
        r.left < m.right &&
        r.right > m.left &&
        r.top < m.bottom &&
        r.bottom > m.top &&
        this.visible(b)
      );
    });
    const label = (/** @type {Element} */ b) => LABEL_ATTRS.map((a) => b.getAttribute(a) || "").join(" ");
    this.log("debug", `minimap buttons: ${buttons.map((b) => JSON.stringify(label(b))).join(", ")}`);
    const byLabel = buttons.find((b) => MINIMAP_SIZE_RE.test(label(b)));
    if (byLabel) return byLabel;
    const corner = (/** @type {Element} */ b) => {
      const r = b.getBoundingClientRect();
      return Math.hypot(m.right - r.right, r.top - m.top);
    };
    return buttons.sort((a, b) => corner(a) - corner(b))[0] || null;
  }

  // --- Synthetic input ----------------------------------------------------------

  /** A full mouse click in the middle of an element. @param {Element} el */
  click(el) {
    const { PointerEvent, MouseEvent } = this.events;
    const r = el.getBoundingClientRect();
    const common = {
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      button: 0,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: this.window,
    };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...common, buttons: 1, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...common, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...common, buttons: 0, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...common, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...common, buttons: 0 }));
  }

  /** A wheel notch over the middle of an element. @param {Element} el @param {number} deltaY */
  wheel(el, deltaY) {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new this.events.WheelEvent("wheel", {
        deltaY,
        deltaMode: 0,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: this.window,
      }),
    );
  }

  // --- Maps' controls in the lower part of the screen -----------------------------

  /** Zoom, compass, floor picker, attribution, …: leaf elements that paint
   * something, plus controls and images. Big layers like the scene don't count.
   * @returns {DOMRect[]} */
  obstacles() {
    const W = this.window.innerWidth;
    const H = this.window.innerHeight;
    const out = [];
    for (const el of this.document.body.querySelectorAll("*")) {
      if (this.isOwn(el)) continue;
      const control = /^(BUTTON|A|INPUT|IMG|CANVAS|svg|VIDEO)$/.test(el.tagName);
      if (el.childElementCount && !control) continue;
      const r = el.getBoundingClientRect();
      if (
        !r.width ||
        !r.height ||
        r.right < W * OBSTACLE_LEFT ||
        r.bottom < H / 2 ||
        r.width * r.height > W * H * OBSTACLE_MAX_AREA
      )
        continue;
      if (!this.visible(el)) continue;
      if (!control && !el.textContent.trim()) {
        const cs = this.getComputedStyle(el);
        const paints =
          cs.backgroundColor !== "rgba(0, 0, 0, 0)" ||
          cs.backgroundImage !== "none" ||
          cs.borderStyle !== "none" ||
          cs.boxShadow !== "none";
        if (!paints) continue;
      }
      out.push(r);
    }
    return out;
  }
}
