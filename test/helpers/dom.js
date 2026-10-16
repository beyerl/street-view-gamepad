// A very small DOM: just what the scripts under test touch.
const ZERO_RECT = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.isConnected = false;
    this.style = {};
    this.className = "";
    this.attributes = {};
    this.listeners = {};
    this.events = []; // dispatched events, for assertions
    this.rect = { ...ZERO_RECT }; // what getBoundingClientRect() reports
    this.visible = true; // what checkVisibility() reports
    this.computed = {}; // overrides for getComputedStyle
    this._text = "";
    this._html = "";
    this.classList = {
      contains: (c) => this.className.split(/\s+/).includes(c),
      add: (c) => { if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim(); },
      remove: (c) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
      toggle: (c, on) => (on ?? !this.classList.contains(c)) ? this.classList.add(c) : this.classList.remove(c),
    };
  }

  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }

  get innerHTML() { return this._html; }
  // Enough for the HUD markup: one child per data-mode, each with a <span>.
  set innerHTML(v) {
    this._html = v;
    this.children = [];
    for (const [, mode] of v.matchAll(/data-mode="(\w+)"/g)) {
      const chip = new FakeElement("div");
      chip.setAttribute("data-mode", mode);
      chip.appendChild(new FakeElement("span"));
      this.appendChild(chip);
    }
  }

  appendChild(child) {
    child.parentElement = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === "string" ? { textContent: n, children: [] } : n);
  }
  insertRow() { return this.appendChild(new FakeElement("tr")); }
  insertCell() { return this.appendChild(new FakeElement("td")); }

  contains(other) {
    for (let e = other; e; e = e.parentElement) if (e === this) return true;
    return false;
  }
  descendants() {
    return this.children.flatMap((c) => [c, ...(c.descendants?.() || [])]);
  }
  // Supports "*", a tag name and [attr=value] (what the scripts use on their own elements).
  matches(sel) {
    if (sel === "*") return true;
    const attr = sel.match(/^\[([\w-]+)=([^\]]+)\]$/);
    if (attr) return this.attributes[attr[1]] === attr[2].replace(/"/g, "");
    return this.tagName === sel.toUpperCase();
  }
  querySelectorAll(sel) { return this.descendants().filter((e) => e.matches?.(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  hasAttribute(k) { return k in this.attributes; }
  removeAttribute(k) { delete this.attributes[k]; }

  addEventListener(type, f) { (this.listeners[type] ||= []).push(f); }
  dispatchEvent(ev) {
    this.events.push(ev);
    for (const f of this.listeners[ev.type] || []) f(ev);
    return true;
  }
  click() { this.dispatchEvent(new FakeEvent("click")); }

  getBoundingClientRect() { return this.rect; }
  checkVisibility() { return this.visible; }
}

// An <audio> element.
class FakeAudio extends FakeElement {
  constructor() {
    super("audio");
    this.src = "";
    this.volume = 1;
    this.paused = true;
    this.currentTime = 0;
    this.playCalls = 0;
    this.playError = null; // reject play() with this
    this.loadCalls = 0;
  }
  play() {
    this.playCalls++;
    if (this.playError) return Promise.reject(this.playError);
    this.paused = false;
    return Promise.resolve();
  }
  pause() { this.paused = true; }
  load() { this.loadCalls++; }
  removeAttribute(k) {
    if (k === "src") this.src = "";
    else super.removeAttribute(k);
  }
}

// Elements are created on first lookup by id, so tests can configure them
// (type, value, ...) before or after the script runs.
function makeDocument({ audioIds = [] } = {}) {
  const byId = new Map();
  const doc = new FakeElement("document");
  doc.hidden = false;
  doc.body = new FakeElement("body");
  doc.body.isConnected = true;
  doc.documentElement = new FakeElement("html");
  doc.documentElement.isConnected = true;
  doc.matchers = []; // [regex, elements]: what querySelectorAll(selector) returns
  doc.el = (id) => {
    if (!byId.has(id)) byId.set(id, audioIds.includes(id) ? new FakeAudio() : new FakeElement("div"));
    return byId.get(id);
  };
  doc.getElementById = doc.el;
  doc.createElement = (tag) => new FakeElement(tag);
  doc.when = (regex, elements) => doc.matchers.push([regex, elements]);
  doc.querySelectorAll = (sel) => {
    for (const [re, els] of doc.matchers) if (re.test(sel)) return els;
    return [];
  };
  doc.querySelector = (sel) => doc.querySelectorAll(sel)[0] || null;
  return doc;
}

const eventClasses = {
  KeyboardEvent: FakeEvent, PointerEvent: FakeEvent, MouseEvent: FakeEvent, WheelEvent: FakeEvent,
};

function makeGamepad(pressed = [], index = 0) {
  return {
    index, id: `Pad ${index}`, connected: true,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  };
}

module.exports = { FakeEvent, FakeElement, FakeAudio, makeDocument, eventClasses, makeGamepad };
