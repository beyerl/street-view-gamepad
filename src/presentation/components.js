// Our own UI on the Maps page, as custom elements with Shadow DOM so that
// Google's styles can't reach them and theirs don't leak. They only display
// what they are given; timing and placement live in views.js.
//
// customElements is null in Chrome's isolated content-script world, so these
// are defined by the page script (MAIN world). Defined through a function so
// tests can pass a window with stand-ins for HTMLElement and customElements.
//
// The constructors must not set attributes (not even `hidden`): Chrome then
// rejects the element created by document.createElement and hands back a
// plain HTMLUnknownElement instead, so nothing would show.

export const Tag = Object.freeze({ HUD: "svgp-hud", TOAST: "svgp-toast", HINT: "svgp-hint" });

// Material "layers", "volume_up", "tab" and "map"
export const ICONS = Object.freeze({
  levels:
    '<svg viewBox="0 0 24 24"><path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/></svg>',
  commentary:
    '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
  browser:
    '<svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h10v4h8v10z"/></svg>',
  minimap:
    '<svg viewBox="0 0 24 24"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>',
});

const TOP = 2147483647; // z-index above everything of Maps

const TOAST_CSS = `:host { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: ${TOP};
  max-width: min(420px, 90vw); padding: 18px 22px; border-radius: 12px; background: rgba(20, 20, 20, .88);
  color: #fff; font: 16px/1.4 system-ui, sans-serif; text-align: center; box-shadow: 0 6px 24px rgba(0, 0, 0, .4); }
:host([hidden]) { display: none; }`;

const HINT_CSS = `:host { position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); z-index: ${TOP};
  padding: 6px 14px; border-radius: 8px; pointer-events: none; background: rgba(20, 20, 20, .75); color: #fff;
  font: 15px/1.4 system-ui, sans-serif; white-space: nowrap; }
:host([hidden]) { display: none; }`;

const HUD_CSS = `:host { position: fixed; z-index: ${TOP - 1}; display: flex; gap: 4px; padding: 4px; border-radius: 10px;
  pointer-events: none; background: rgba(20, 20, 20, .78); font: 13px/1 system-ui, sans-serif; color: #fff; }
:host([hidden]) { display: none; }
.m { display: flex; align-items: center; gap: 6px; padding: 5px 7px; border-radius: 7px; color: #80868b; opacity: .6; }
.m.active { opacity: 1; background: rgba(255, 255, 255, .16); }
.m.on[data-mode=levels] { color: #4fc3f7; }
.m.on[data-mode=commentary] { color: #ffb74d; }
.m.on[data-mode=browser] { color: #81c784; }
.m.on[data-mode=minimap] { color: #ba68c8; }
.m.playing svg { animation: pulse 1.2s ease-in-out infinite; }
svg { width: 20px; height: 20px; fill: currentColor; }
span { color: #fff; max-width: 16em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m:not(.active) span, span:empty { display: none; }
@keyframes pulse { 50% { opacity: .4; } }`;

/** @param {{ HTMLElement: typeof HTMLElement, customElements: CustomElementRegistry }} win */
export function defineComponents(win) {
  /** A box of text: the toast and the hint. */
  class TextBox extends win.HTMLElement {
    /** @param {string} css */
    constructor(css) {
      super();
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `<style>${css}</style><div part="text"></div>`;
      this.textEl = root.lastElementChild;
    }
    /** @param {string} text */
    set text(text) {
      this.textEl.textContent = text;
    }
    get text() {
      return this.textEl.textContent;
    }
  }

  class Toast extends TextBox {
    constructor() {
      super(TOAST_CSS);
    }
  }

  class Hint extends TextBox {
    constructor() {
      super(HINT_CSS);
    }
  }

  /** The modes, as icons, the current one highlighted with a label. */
  class Hud extends win.HTMLElement {
    constructor() {
      super();
      this.root = this.attachShadow({ mode: "open" });
      this.root.innerHTML = `<style>${HUD_CSS}</style>`;
      /** @type {Map<string, Element>} */
      this.chips = new Map();
    }

    /** @param {import("./hud-model.js").Chip[]} chips */
    render(chips) {
      for (const c of chips) {
        let el = this.chips.get(c.id);
        if (!el) {
          el = this.root.ownerDocument.createElement("div");
          el.className = "m";
          el.setAttribute("data-mode", c.id);
          el.innerHTML = `${ICONS[c.id] || ""}<span></span>`;
          this.root.appendChild(el);
          this.chips.set(c.id, el);
        }
        el.classList.toggle("active", c.active);
        el.classList.toggle("on", c.on);
        el.classList.toggle("playing", c.playing);
        el.querySelector("span").textContent = c.label;
      }
    }

    /** @param {string} id */
    chip(id) {
      return this.chips.get(id);
    }
  }

  for (const [tag, cls] of [
    [Tag.TOAST, Toast],
    [Tag.HINT, Hint],
    [Tag.HUD, Hud],
  ]) {
    if (!win.customElements.get(/** @type {string} */ (tag)))
      win.customElements.define(/** @type {string} */ (tag), /** @type {any} */ (cls));
  }
}
