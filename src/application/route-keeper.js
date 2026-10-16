// With directions open, the minimap in Street View shows the route. A jump
// loads a new URL, so it carries the route over (see JumpService). The route
// is also remembered for the tab, in case the page after a jump doesn't show
// it in its URL, and forgotten once the user closes it.

import { MapsUrl } from "../domain/maps-url.js";
import { SessionKey } from "../shared/storage-keys.js";

export class RouteKeeper {
  /**
   * @param {import("../ports/index.js").KeyValueStore} store
   * @param {import("../ports/index.js").PageNavigator} navigator
   * @param {(level: string, ...a: any[]) => void} log
   */
  constructor(store, navigator, log) {
    this.store = store;
    this.navigator = navigator;
    this.log = log;
    /** @type {import("../domain/maps-url.js").Route | null} */
    this.saved = null;
    this.seen = false; // the URL showed a route since this page loaded
    // Only a jump carries the route over a reload; any other page load starts afresh.
    if (store.get(SessionKey.JUMPED)) {
      try {
        this.saved = JSON.parse(store.get(SessionKey.ROUTE) || "null");
      } catch {
        this.saved = null;
      }
    }
    store.remove(SessionKey.JUMPED);
    this.save(this.saved);
  }

  /** @param {import("../domain/maps-url.js").Route | null} route */
  save(route) {
    this.saved = route;
    if (route) this.store.set(SessionKey.ROUTE, JSON.stringify(route));
    else this.store.remove(SessionKey.ROUTE);
  }

  /** Polled: keep the saved route in step with the URL. It goes when it
   * disappears from the URL (directions closed), or on the map without one. */
  update() {
    const url = new MapsUrl(this.navigator.href);
    const r = url.route;
    if (r) {
      this.seen = true;
      if (JSON.stringify(r) !== JSON.stringify(this.saved)) this.save(r);
    } else if (this.saved && (this.seen || !url.isStreetView)) {
      this.log("debug", "route closed");
      this.save(null);
    }
  }

  current() {
    this.update();
    return this.saved;
  }

  /** Called just before a jump reloads the page. */
  markJump() {
    this.store.set(SessionKey.JUMPED, "1");
  }
}
