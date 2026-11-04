import {
  MINIMAP_MAX_ZOOM_STEPS,
  MINIMAP_RESTORE_POLLS,
  MINIMAP_SIZE_RATIO,
  TOAST_SHORT,
  WHEEL_STEP,
} from "../shared/config.js";
import { SessionKey } from "../shared/storage-keys.js";

/** Enlarges or shrinks Street View's minimap by clicking its own button, and
 * zooms it with the mouse wheel. Its size and zoom are carried over a jump: a
 * jump reloads the page, which starts with the minimap at its defaults. And
 * it always shows where there is imagery. */
export class MinimapService {
  /** @param {import("../ports/index.js").MapsPage} page @param {import("../ports/index.js").Toast} toast
   * @param {import("../ports/index.js").KeyValueStore} [store] @param {(level: string, ...a: any[]) => void} [log] */
  constructor(page, toast, store, log = () => {}) {
    this.page = page;
    this.toast = toast;
    this.store = store;
    this.log = log;
    const saved = Number(store?.get(SessionKey.MINIMAP_WIDTH));
    /** The minimap's width before the jump that loaded this page, if any. */
    this.restoreWidth = saved > 0 ? saved : 0;
    /** Zoom steps still to replay after a jump: + in, - out. */
    this.restoreZoom = clampSteps(Number(store?.get(SessionKey.MINIMAP_ZOOM)) || 0);
    store?.remove(SessionKey.MINIMAP_WIDTH);
    store?.remove(SessionKey.MINIMAP_ZOOM);
    /** Steps the minimap is zoomed from where this page started it, plus those replayed. */
    this.zoomSteps = 0;
    this.wheelRest = 0; // wheel turned short of a step
    this.lastWidth = 0;
    this.polls = 0;
  }

  toggle() {
    const button = this.page.minimapSizeButton(this.page.minimap());
    if (button) this.page.click(button);
    else this.toast.show("No minimap here.", TOAST_SHORT);
  }

  /** @param {number} step +1 zooms in, -1 out */
  zoom(step) {
    const map = this.page.minimap();
    if (!map) {
      this.toast.show("No minimap here.", TOAST_SHORT);
      return;
    }
    this.page.wheel(map, -step * WHEEL_STEP);
    this.zoomed(step);
  }

  /** The user zoomed the minimap themselves, with its +/- buttons. @param {number} step */
  zoomed(step) {
    this.zoomSteps = clampSteps(this.zoomSteps + step);
  }

  /** The user turned the mouse wheel over the minimap: a notch is a step,
   * a trackpad's many small deltas add up to steps. @param {number} deltaY */
  wheeled(deltaY) {
    this.wheelRest -= deltaY / WHEEL_STEP;
    const steps = Math.trunc(this.wheelRest);
    this.wheelRest -= steps;
    if (steps) this.zoomed(steps);
  }

  width() {
    return this.page.minimap()?.getBoundingClientRect().width ?? 0;
  }

  /** Called just before a jump reloads the page. */
  remember() {
    const w = this.width();
    if (w > 0) this.store?.set(SessionKey.MINIMAP_WIDTH, String(Math.round(w)));
    // Steps not replayed yet still count.
    const zoom = clampSteps(this.zoomSteps + this.restoreZoom);
    if (zoom) this.store?.set(SessionKey.MINIMAP_ZOOM, String(zoom));
  }

  /** Polled: the small minimap shows where there is imagery only while
   * hovered, and the enlarged one has a switch for it; keep both on. */
  showImagery() {
    const map = this.page.minimap();
    if (map) this.page.hover(map);
    const toggle = this.page.minimapImageryToggle();
    if (toggle?.getAttribute("aria-checked") === "false") {
      this.log("info", "minimap: showing imagery again");
      this.page.click(toggle);
    }
  }

  /** Polled after a jump: once the minimap has kept its size for two polls,
   * click its size button if that is clearly not the size before the jump,
   * then replay the zoom, a step per poll. Gives up after a while. */
  restore() {
    if (this.restoreWidth) this.restoreSize();
    else if (this.restoreZoom && this.page.minimap()) {
      const step = Math.sign(this.restoreZoom);
      this.restoreZoom -= step;
      this.zoom(step);
    }
  }

  restoreSize() {
    const w = this.width();
    const settled = w > 0 && Math.abs(w - this.lastWidth) < 1;
    this.lastWidth = w;
    if (!settled) {
      if (++this.polls >= MINIMAP_RESTORE_POLLS) this.restoreWidth = this.restoreZoom = 0;
      return;
    }
    const ratio = Math.max(w, this.restoreWidth) / Math.min(w, this.restoreWidth);
    if (ratio >= MINIMAP_SIZE_RATIO) {
      this.log("info", `minimap ${Math.round(w)} px wide, was ${this.restoreWidth}: resizing`);
      const button = this.page.minimapSizeButton(this.page.minimap());
      if (button) this.page.click(button);
    }
    this.restoreWidth = 0;
  }
}

/** @param {number} n */
const clampSteps = (n) => Math.max(-MINIMAP_MAX_ZOOM_STEPS, Math.min(MINIMAP_MAX_ZOOM_STEPS, Math.round(n)));
