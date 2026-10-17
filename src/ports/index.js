// Interfaces the application layer depends on. Infrastructure adapters
// implement them; tests pass fakes with the same shape. They are written as
// abstract classes so that `tsc --checkJs` can check implementations
// (`@implements`), and so a missing method fails loudly.

/* eslint-disable no-unused-vars */

/** @typedef {import("../domain/geo.js").GeoPoint} GeoPoint */
/** @typedef {import("../domain/maps-url.js").PanoTarget} PanoTarget */

/** @interface */
export class PanoramaRepository {
  /** The panorama (Google's or user-contributed) nearest to a point.
   * @param {GeoPoint} point @param {number} radiusM @returns {Promise<PanoTarget | null>} */
  async nearest(point, radiusM) {
    throw new Error("abstract");
  }
}

/** @interface */
export class ArticleRepository {
  /** @param {GeoPoint} point @returns {Promise<import("../domain/articles.js").ArticlePlaylist | null>} */
  async nearby(point) {
    throw new Error("abstract");
  }
  /** @param {string} lang @param {number} pageid @returns {Promise<import("../domain/articles.js").Article>} */
  async details(lang, pageid) {
    throw new Error("abstract");
  }
}

/** @interface */
export class RecordingRepository {
  /** @returns {Promise<import("../domain/recordings.js").RecordingLocation[]>} */
  async locations() {
    throw new Error("abstract");
  }
  /** @param {number} locid @returns {Promise<import("../domain/recordings.js").Recording[]>} the recordings made there */
  async playlist(locid) {
    throw new Error("abstract");
  }
}

/** A string key-value store (sessionStorage), tolerant of storage being unavailable. @interface */
export class KeyValueStore {
  /** @param {string} key @returns {string | null} */
  get(key) {
    throw new Error("abstract");
  }
  /** @param {string} key @param {string} value */
  set(key, value) {
    throw new Error("abstract");
  }
  /** @param {string} key */
  remove(key) {
    throw new Error("abstract");
  }
}

/** Messages within the page, between the page script and the bridge. @interface */
export class MessageBus {
  /** @param {string} type @param {object} [payload] */
  post(type, payload) {
    throw new Error("abstract");
  }
  /** @param {string} type @param {(msg: any) => void} handler */
  on(type, handler) {
    throw new Error("abstract");
  }
}

/** Runs callbacks repeatedly or once. @interface */
export class Scheduler {
  /** @param {number} ms @param {() => void} fn */
  every(ms, fn) {
    throw new Error("abstract");
  }
  /** @param {number} ms @param {() => void} fn @returns {unknown} a handle for cancel() */
  after(ms, fn) {
    throw new Error("abstract");
  }
  /** @param {unknown} handle */
  cancel(handle) {
    throw new Error("abstract");
  }
  /** @returns {number} ms, monotonic */
  now() {
    throw new Error("abstract");
  }
}

/** @interface */
export class PageNavigator {
  /** @returns {string} */
  get href() {
    throw new Error("abstract");
  }
  /** @returns {string} */
  get origin() {
    throw new Error("abstract");
  }
  /** @returns {string} */
  get search() {
    throw new Error("abstract");
  }
  /** @param {string} url */
  assign(url) {
    throw new Error("abstract");
  }
  back() {
    throw new Error("abstract");
  }
  forward() {
    throw new Error("abstract");
  }
}

/** @interface */
export class InputSource {
  /** Connected gamepads. @returns {import("../domain/binding.js").PadState[]} */
  pads() {
    throw new Error("abstract");
  }
}

/** How buttons act on the view: Street View (keys) or the map (drag and wheel). Strategy. @interface */
export class ViewControls {
  /** The press / repeat / release behaviour of a held action, or null if this view has none.
   * @param {string} action @returns {{ down(repeat: boolean): void, up(): void } | null} */
  held(action) {
    throw new Error("abstract");
  }
  /** Continuous look / pan in direction (dx, dy), each -1, 0 or 1, for `dt` ms. @param {number} dx @param {number} dy @param {number} dt */
  look(dx, dy, dt) {
    throw new Error("abstract");
  }
  /** Whether walking buttons pan (the map) rather than walk. @returns {boolean} */
  get walkPans() {
    throw new Error("abstract");
  }
}

/** A short message in the middle of the screen. @interface */
export class Toast {
  /** @param {string} text @param {number} [ms] 0 keeps it until replaced */
  show(text, ms) {
    throw new Error("abstract");
  }
  hide() {
    throw new Error("abstract");
  }
}

/** Google Maps' own page: everything found by inspecting its (obfuscated) DOM. @interface */
export class MapsPage {
  /** @returns {{ items: { el: Element, label: string }[], current: number } | null} */
  findLevelPicker() {
    throw new Error("abstract");
  }
  /** @returns {Element | null} */
  minimap() {
    throw new Error("abstract");
  }
  /** @param {Element | null} map the minimap, if found @returns {Element | null} */
  minimapSizeButton(map) {
    throw new Error("abstract");
  }
  /** @param {Element} el */
  click(el) {
    throw new Error("abstract");
  }
  /** @param {Element} el @param {number} deltaY */
  wheel(el, deltaY) {
    throw new Error("abstract");
  }
  /** Hide or show the search bar and title card. @param {boolean} hidden */
  setOverlayHidden(hidden) {
    throw new Error("abstract");
  }
}

/** Plays audio in the offscreen document. @interface */
export class OffscreenAudio {
  /** @param {object} msg one of OffscreenMsg, with its fields @returns {Promise<any>} */
  async send(msg) {
    throw new Error("abstract");
  }
  /** @returns {Promise<boolean>} */
  async isOpen() {
    throw new Error("abstract");
  }
}

/** Text to speech, one audio blob per sentence. @interface */
export class SpeechSynthesizer {
  /** @param {string} text @param {string} lang @returns {AsyncIterable<Blob>} */
  speak(text, lang) {
    throw new Error("abstract");
  }
  /** @param {string} lang @returns {Promise<void>} */
  async preload(lang) {
    throw new Error("abstract");
  }
}
