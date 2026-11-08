// A Virtual Visit stop on the Maps page (see domain/visit.js). The game opens
// the walking route as a map, because a Street View URL needs a panorama id;
// we look up the panorama nearest to the route's start and enter Street View
// there, facing the destination, with the route kept on the minimap. Then
// every move is reported (the bridge stores it for the game), and pressing
// both shoulder buttons together finishes the stop.

import { MapsUrl } from "../domain/maps-url.js";
import { parsePoint, VisitState } from "../domain/visit.js";
import { TOAST_LONG, VISIT_ENTER_RADII, VISIT_FINISH_BUTTONS } from "../shared/config.js";
import { Msg } from "../shared/messages.js";
import { SessionKey } from "../shared/storage-keys.js";

const HELLO = "Virtual Visit: press L + R together to finish this stop.";
const NO_PANO = "No Street View at the start of this walk. Drop the pegman on the route.";
const BACK = "Back to Virtual Visit…";

export class VisitService {
  /**
   * @param {{ bus: import("../ports/index.js").MessageBus, navigator: import("../ports/index.js").PageNavigator,
   *           panoramas: import("../ports/index.js").PanoramaRepository, input: import("../ports/index.js").InputSource,
   *           toast: import("../ports/index.js").Toast, store: import("../ports/index.js").KeyValueStore, isHidden: () => boolean,
   *           routes?: import("./route-keeper.js").RouteKeeper, log: (level: string, ...a: any[]) => void }} deps
   */
  constructor({ bus, navigator, panoramas, input, toast, store, isHidden, routes, log }) {
    this.bus = bus;
    this.routes = routes;
    this.navigator = navigator;
    this.panoramas = panoramas;
    this.input = input;
    this.toast = toast;
    this.store = store;
    this.isHidden = isHidden;
    this.log = log;
    /** @type {import("../domain/visit.js").Visit | null} */
    this.visit = null;
    this.lastKey = "";
    this.chordWas = false;
    this.entering = false;
    this.finishing = false;
    bus.on(Msg.VISIT, (m) => this.onVisit(m.visit ?? null));
    bus.post(Msg.GET_VISIT);
  }

  get active() {
    return !!this.visit && !this.visit.finished && !this.finishing;
  }

  /** Whether this tab was sent here by the game. A visit is kept until the game
   * takes it back, so one left unfinished must not change other Maps tabs. */
  get inThisTab() {
    return this.active && this.store.get(SessionKey.VISIT_TAB) === this.visit.slot + this.visit.startedAt;
  }

  /** @param {import("../domain/visit.js").Visit | null} visit */
  onVisit(visit) {
    this.visit = visit;
    if (!this.active) return;
    // Once per stop and tab: jumps and walking reload the page.
    if (this.store.get(SessionKey.VISIT_GREETED) !== visit.slot + visit.startedAt) {
      this.store.set(SessionKey.VISIT_GREETED, visit.slot + visit.startedAt);
      this.toast.show(HELLO, TOAST_LONG);
    }
    if (visit.state === VisitState.ENTERING) {
      this.store.set(SessionKey.VISIT_TAB, visit.slot + visit.startedAt);
      this.enter();
    }
  }

  /** Street View at the start of the route, facing its end. */
  async enter() {
    if (this.entering || !this.visit) return;
    this.entering = true;
    try {
      const url = new MapsUrl(this.navigator.href);
      if (url.isStreetView) return this.bus.post(Msg.VISIT_ENTERED);
      const from = parsePoint(this.visit.origin);
      const to = parsePoint(this.visit.destination);
      if (!from || !to) return;
      let target = null;
      for (const r of VISIT_ENTER_RADII) {
        target = await this.panoramas.nearest(from, r).catch((e) => (this.log("info", e), null));
        if (target) break;
      }
      this.bus.post(Msg.VISIT_ENTERED);
      if (!target) return this.toast.show(NO_PANO, TOAST_LONG);
      const { origin, search } = this.navigator;
      const heading = from.to(to).bearing;
      this.log("info", "visit: entering Street View at", target.id);
      this.routes?.carryOver(url.route);
      this.navigator.assign(
        MapsUrl.forPanorama({ origin, search, target, fov: "75", heading, tilt: "90", route: url.route }),
      );
    } finally {
      this.entering = false;
    }
  }

  /** Polled: report a new position. */
  update() {
    if (!this.active || this.visit.state !== VisitState.VISITING) return;
    const pano = new MapsUrl(this.navigator.href).panorama;
    if (!pano) return;
    const key = `${pano.id}|${Math.round(pano.heading)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.bus.post(Msg.VISIT_MOVED, {
      position: { lat: pano.point.lat, lng: pano.point.lng, heading: pano.heading, url: this.navigator.href },
    });
  }

  /** Every tick: both shoulder buttons going down together finishes the stop. */
  tick() {
    if (!this.active || this.isHidden()) {
      this.chordWas = false;
      return;
    }
    const chord = this.input.pads().some((pad) => VISIT_FINISH_BUTTONS.every((i) => pad.buttons[i]?.pressed));
    if (chord && !this.chordWas) this.finish();
    this.chordWas = chord;
  }

  finish() {
    if (!this.active) return;
    this.update();
    this.finishing = true;
    this.toast.show(BACK);
    this.log("info", "visit: finished");
    this.bus.post(Msg.VISIT_FINISH);
  }
}
