// With directions open, the minimap in Street View shows the route. A jump
// loads a new URL, so it carries the route over (see JumpService). The route
// is also remembered for the tab: in Street View, Maps rewrites the URL after
// loading and after its own steps, often without the route, so the route
// only counts as closed on the map without directions.

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

  /** Polled: keep the saved route in step with the URL. A URL showing the
   * same directions without their data blocks (travel mode, places) keeps the
   * saved ones. The route goes only on the map without directions: in Street
   * View a URL without them says nothing. */
  update() {
    const url = new MapsUrl(this.navigator.href);
    const r = url.route;
    if (r) {
      if (!r.data && r.dir === this.saved?.dir) return;
      if (JSON.stringify(r) !== JSON.stringify(this.saved)) this.save(r);
    } else if (this.saved && !url.isStreetView) {
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

  /** Called just before we load a URL showing `route`: the page after it keeps
   * the route even if Maps drops it from the URL before we look.
   * @param {import("../domain/maps-url.js").Route | null} route */
  carryOver(route) {
    if (route) this.save(route);
    this.markJump();
  }
}
