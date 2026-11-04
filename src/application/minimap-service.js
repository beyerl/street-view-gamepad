import { MINIMAP_RESTORE_POLLS, MINIMAP_SIZE_RATIO, TOAST_SHORT, WHEEL_STEP } from "../shared/config.js";
import { SessionKey } from "../shared/storage-keys.js";

/** Enlarges or shrinks Street View's minimap by clicking its own button, and
 * zooms it with the mouse wheel. Its size is carried over a jump: a jump
 * reloads the page, which starts with the minimap at its default size. */
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
    store?.remove(SessionKey.MINIMAP_WIDTH);
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
    if (map) this.page.wheel(map, -step * WHEEL_STEP);
    else this.toast.show("No minimap here.", TOAST_SHORT);
  }

  width() {
    return this.page.minimap()?.getBoundingClientRect().width ?? 0;
  }

  /** Called just before a jump reloads the page. */
  remember() {
    const w = this.width();
    if (w > 0) this.store?.set(SessionKey.MINIMAP_WIDTH, String(Math.round(w)));
  }

  /** Polled after a jump: once the minimap has kept its size for two polls,
   * click its size button if that is clearly not the size before the jump.
   * Gives up after a while. */
  restore() {
    if (!this.restoreWidth) return;
    const w = this.width();
    const settled = w > 0 && Math.abs(w - this.lastWidth) < 1;
    this.lastWidth = w;
    if (!settled) {
      if (++this.polls >= MINIMAP_RESTORE_POLLS) this.restoreWidth = 0;
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
