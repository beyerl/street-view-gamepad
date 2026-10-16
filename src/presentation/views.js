// The page's own UI as the application layer sees it: show a message, show
// the hint, render the HUD. These add timing and placement to the dumb
// components of components.js.

import { HUD_MARGIN } from "../shared/config.js";
import { Toast } from "../ports/index.js";
import { Tag } from "./components.js";
import { hudChips, placeBox } from "./hud-model.js";

/** @param {Document} document @param {string} tag */
function createElement(document, tag) {
  const el = /** @type {any} */ (document.createElement(tag));
  return el;
}

/** @param {Document} document @param {Element} el */
function ensureAttached(document, el) {
  if (!el.isConnected) document.body.appendChild(el);
}

/** @implements {Toast} */
export class ToastView extends Toast {
  /** @param {Document} document @param {import("../ports/index.js").Scheduler} scheduler */
  constructor(document, scheduler) {
    super();
    this.document = document;
    this.scheduler = scheduler;
    this.el = createElement(document, Tag.TOAST);
    this.timer = null;
  }
  show(/** @type {string} */ text, ms = 0) {
    this.scheduler.cancel(this.timer);
    this.el.text = text;
    this.el.hidden = false;
    ensureAttached(this.document, this.el);
    if (ms) this.timer = this.scheduler.after(ms, () => this.hide());
  }
  hide() {
    this.scheduler.cancel(this.timer);
    this.el.hidden = true;
  }
  get text() {
    return this.el.hidden ? "" : this.el.text;
  }
}

/** The distance to the next jump point, at the bottom of the screen. */
export class HintView {
  /** @param {Document} document */
  constructor(document) {
    this.document = document;
    this.el = createElement(document, Tag.HINT);
  }
  /** @param {string} text "" hides it */
  show(text) {
    this.el.text = text;
    this.el.hidden = !text;
    if (text) ensureAttached(this.document, this.el);
  }
  get text() {
    return this.el.hidden ? "" : this.el.text;
  }
}

/** The mode display in the lower right corner, clear of Maps' own controls. */
export class HudView {
  /** @param {Document} document @param {Window} window @param {{ obstacles(): DOMRect[] }} page */
  constructor(document, window, page) {
    this.document = document;
    this.window = window;
    this.page = page;
    this.el = createElement(document, Tag.HUD);
    this.el.style.right = this.el.style.bottom = `${HUD_MARGIN}px`;
  }

  /** @param {boolean} show @param {Parameters<typeof hudChips>[0]} [state] */
  render(show, state) {
    this.el.hidden = !show;
    if (!show || !state) return;
    ensureAttached(this.document, this.el);
    this.el.render(hudChips(state));
  }

  place() {
    if (this.el.hidden || !this.el.isConnected) return;
    const { width, height } = this.el.getBoundingClientRect();
    const viewport = { width: this.window.innerWidth, height: this.window.innerHeight };
    const { right, bottom } = placeBox(viewport, { width, height }, this.page.obstacles(), HUD_MARGIN);
    this.el.style.right = `${right}px`;
    this.el.style.bottom = `${bottom}px`;
  }
}
