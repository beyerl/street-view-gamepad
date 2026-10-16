import { SessionKey } from "../shared/storage-keys.js";

/** Hides and shows Maps' search bar and title card; remembered for the tab. */
export class OverlayService {
  /** @param {import("../ports/index.js").MapsPage} page @param {import("../ports/index.js").KeyValueStore} store @param {(level: string, ...a: any[]) => void} log */
  constructor(page, store, log) {
    this.page = page;
    this.store = store;
    this.log = log;
    this.hidden = store.get(SessionKey.OVERLAY_HIDDEN) === "1";
  }

  toggle() {
    this.hidden = !this.hidden;
    this.store.set(SessionKey.OVERLAY_HIDDEN, this.hidden ? "1" : "");
    this.page.setOverlayHidden(this.hidden);
    this.log("info", this.hidden ? "search bar hidden" : "search bar shown");
  }

  /** Polled: Maps re-renders these panels (e.g. a new title card after walking). */
  refresh() {
    if (this.hidden) this.page.setOverlayHidden(true);
  }
}
