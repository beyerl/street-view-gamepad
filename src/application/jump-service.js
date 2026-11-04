// User-contributed photospheres usually have no links to their neighbours, so
// walking does nothing there. Whenever the view direction changes, look up the
// nearest panorama roughly ahead and show its distance. If the panorama hasn't
// changed shortly after a walk press, go there. Strafing jumps to the side.
//
// In buildings with several floors, such as big stations, Google links
// panoramas across floors (stairs, escalators), and both its own walking and
// the nearest panorama ahead often lead to another floor. So jumps prefer
// panoramas on the current floor, and where Google's walk would change floors
// we jump along the current one instead.

import { formatDistance, Heading } from "../domain/geo.js";
import { MapsUrl, sameLevel } from "../domain/maps-url.js";
import { SessionKey } from "../shared/storage-keys.js";
import {
  AHEAD_DELAY,
  AHEAD_REUSE_ANGLE,
  HERE_RADIUS,
  JUMP_CHECK_DELAY,
  JUMP_MAX_ANGLE,
  JUMP_SEARCH_WIDTH,
  JUMP_STEPS,
  TOAST_LONG,
  WALK_LINK_ANGLE,
} from "../shared/config.js";

export const Turn = Object.freeze({ AHEAD: 0, BEHIND: 180, LEFT: -90, RIGHT: 90 });
export const WalkEdge = Object.freeze({ FORWARD: "fwd", BACK: "back" });

const SEARCHING = "Searching for the next Street View point…";
const NOT_FOUND = "No Street View point found in this direction.";

/**
 * @typedef {import("../domain/maps-url.js").PanoView} PanoView
 * @typedef {import("../domain/maps-url.js").PanoLink} PanoLink
 * @typedef {import("../domain/maps-url.js").Level} Level
 * @typedef {PanoLink & { m: number }} Hit
 */

export class JumpService {
  /**
   * @param {{ panoramas: import("../ports/index.js").PanoramaRepository, navigator: import("../ports/index.js").PageNavigator,
   *           routes: import("./route-keeper.js").RouteKeeper, scheduler: import("../ports/index.js").Scheduler,
   *           toast: import("../ports/index.js").Toast, hint: { show(text: string): void },
   *           store?: import("../ports/index.js").KeyValueStore, photos?: { allowed: boolean },
   *           onLeave?: () => void, log: (level: string, ...a: any[]) => void }} deps
   *   onLeave: called just before a jump reloads the page
   */
  constructor({ panoramas, navigator, routes, scheduler, toast, hint, store, photos, onLeave, log }) {
    this.panoramas = panoramas;
    this.navigator = navigator;
    this.routes = routes;
    this.scheduler = scheduler;
    this.toast = toast;
    this.hint = hint;
    this.store = store;
    this.photos = photos;
    this.onLeave = onLeave;
    this.log = log;
    /** @type {Map<string, Level | null>} the floor of every panorama a search came across */
    this.levels = new Map();
    /** @type {{ id: string, links: PanoLink[] | null } | null} the current panorama's links, if looked up */
    this.here = null;
    this.hereFor = ""; // the panorama the latest such lookup is for
    /** Whether the last panorama we knew the floor of was in a building. */
    this.indoors = store?.get(SessionKey.INDOORS) === "1";
    this.leaving = ""; // the panorama we are jumping away from, until the page changes
    this.takenOver = ""; // the panorama whose walk press we turned into a jump
    /** @type {{ pano: string, heading: number, target: Hit | null } | null} latest lookup for the view direction */
    this.ahead = null;
    /** @type {{ id: string, heading: number } | null} the view a lookup was last started for */
    this.aheadView = null;
    this.aheadTimer = null;
    this.aheadSearch = 0; // increments to invalidate a running lookup
    /** @type {{ pano: string, at: number, back: boolean } | null} pending "did walking work?" check */
    this.check = null;
    this.search = 0; // increments to invalidate a running search
    this.searching = false;
  }

  url() {
    return new MapsUrl(this.navigator.href);
  }

  /** @returns {PanoView | null} */
  pano() {
    return this.url().panorama;
  }

  /** @param {import("../domain/geo.js").GeoPoint} point @param {number} radius */
  async nearest(point, radius) {
    try {
      const hit = await this.panoramas.nearest(point, radius, { userPhotos: this.photos?.allowed ?? true });
      if (hit) for (const p of [hit, ...(hit.links ?? [])]) if (p.level !== undefined) this.levels.set(p.id, p.level);
      return hit;
    } catch (err) {
      this.log("info", err);
      return null;
    }
  }

  /** The floor of a panorama: null outdoors, undefined if not known. @param {string} id */
  levelOf(id) {
    return this.levels.get(id);
  }

  /** Search circles centred ever farther ahead, each about as wide as its
   * distance, and keep the nearest hit that lies in the direction, on the
   * current floor if there is one there. The panoramas the hits link to, and
   * the current one links to, count as hits too.
   * @param {PanoView} from @param {number} heading @returns {Promise<Hit | null>} */
  async findAhead(from, heading) {
    const hits = await Promise.all(
      JUMP_STEPS.map((d) => this.nearest(from.point.offset(heading, d), d * JUMP_SEARCH_WIDTH)),
    );
    const level = this.levelOf(from.id);
    const links = this.here?.id === from.id ? (this.here.links ?? []) : [];
    /** @type {Hit | null} */
    let best = null;
    /** @type {Hit | null} */
    let onFloor = null;
    for (const p of [...links, ...hits.flatMap((h) => (h ? [h, ...(h.links ?? [])] : []))]) {
      if (p.id === from.id) continue;
      const { m, bearing } = from.point.to(p);
      if (m < 1 || Heading.diff(bearing, heading) > JUMP_MAX_ANGLE) continue;
      const hit = { type: p.type, id: p.id, lat: p.lat, lng: p.lng, level: p.level, m };
      if (!best || m < best.m) best = hit;
      if (sameLevel(p.level, level) && (!onFloor || m < onFloor.m)) onFloor = hit;
    }
    return onFloor ?? best;
  }

  /** Look up the current panorama's floor and links, once per panorama. @param {PanoView} p */
  async lookHere(p) {
    if (this.hereFor === p.id) return;
    this.hereFor = p.id;
    const hit = await this.nearest(p.point, HERE_RADIUS);
    if (this.hereFor !== p.id) return;
    this.here = { id: p.id, links: hit?.id === p.id ? (hit.links ?? []) : null };
    const level = this.levelOf(p.id);
    if (level === undefined) return;
    this.indoors = level !== null;
    this.store?.set(SessionKey.INDOORS, this.indoors ? "1" : "");
  }

  /**
   * Called before Street View walks one step (`back`: backwards; `repeat`: the
   * button is held). Returns true if Google's walk must not happen: when it
   * would go to another floor, then this jumps along the current floor
   * instead, and in a building while the new panorama's floor is still being
   * looked up (a press then jumps once the walk check finds it stuck).
   * @param {boolean} back
   */
  guardWalk(back) {
    const from = this.url().isStreetView && this.pano();
    if (!from) return false;
    if (this.searching || this.leaving === from.id) return true;
    const level = this.levelOf(from.id);
    if (this.here?.id !== from.id) {
      this.lookHere(from);
      return this.indoors && level !== null;
    }
    if (!level || !this.here.links) return false;
    const heading = Heading.normalize(from.heading + (back ? Turn.BEHIND : Turn.AHEAD));
    /** @type {{ link: PanoLink, off: number } | null} */
    let next = null; // the link Google walks along: the one closest to the direction
    for (const link of this.here.links) {
      const { m, bearing } = from.point.to(link);
      const off = Heading.diff(bearing, heading);
      if (link.id !== from.id && m >= 1 && off <= WALK_LINK_ANGLE && (!next || off < next.off)) next = { link, off };
    }
    if (!next || next.link.level === undefined || sameLevel(next.link.level, level)) return false;
    this.log("info", `Google would walk to floor ${next.link.level?.label ?? "outside"}; staying on ${level.label}`);
    this.takenOver = from.id;
    this.jump(back ? Turn.BEHIND : Turn.AHEAD, { ...next.link, m: from.point.distanceTo(next.link) });
    return true;
  }

  /** Polled: start a lookup once the view has rested on a new panorama or heading. */
  updateAhead() {
    const url = this.url();
    const p = url.isStreetView && url.panorama;
    if (!p) {
      this.scheduler.cancel(this.aheadTimer);
      this.aheadSearch++;
      this.ahead = this.aheadView = null;
      this.hint.show("");
      return;
    }
    this.lookHere(p);
    if (this.aheadView && this.aheadView.id === p.id && Heading.diff(this.aheadView.heading, p.heading) < 1) return;
    this.aheadView = { id: p.id, heading: p.heading };
    this.scheduler.cancel(this.aheadTimer);
    this.aheadTimer = this.scheduler.after(AHEAD_DELAY, async () => {
      const seq = ++this.aheadSearch;
      const target = await this.findAhead(p, p.heading);
      if (seq !== this.aheadSearch) return;
      this.ahead = { pano: p.id, heading: p.heading, target };
      this.hint.show(target ? `Next jump point ${formatDistance(target.m)}` : "No jump point in this direction");
    });
  }

  /** Forget the lookups, e.g. when user photos are switched on or off. */
  refresh() {
    this.scheduler.cancel(this.aheadTimer);
    this.aheadSearch++;
    this.ahead = this.aheadView = this.here = null;
    this.hereFor = "";
  }

  cancel() {
    this.check = null;
    this.search++;
    if (this.searching) this.toast.hide();
    this.searching = false;
  }

  /** Go to the next point `turn`° off the view direction, reusing the lookup
   * shown in the hint when it still matches the view. Stepping to the side
   * keeps the view direction; walking looks the way it went.
   * @param {number} turn @param {Hit | null} [fallback] where to go if the search finds nothing */
  async jump(turn, fallback = null) {
    const from = this.pano();
    if (!from || this.leaving === from.id) return;
    const heading = Heading.normalize(from.heading + turn);
    const view = Math.abs(turn) === Turn.RIGHT ? from.heading : heading;
    let target;
    const a = this.ahead;
    if (turn === Turn.AHEAD && a?.pano === from.id && Heading.diff(a.heading, from.heading) <= AHEAD_REUSE_ANGLE) {
      target = a.target;
    } else {
      const seq = ++this.search;
      this.searching = true;
      this.toast.show(SEARCHING);
      target = await this.findAhead(from, heading);
      if (seq !== this.search) return;
      this.searching = false;
      const now = this.pano();
      if (now?.id !== from.id || Heading.diff(now.heading, from.heading) > JUMP_MAX_ANGLE) {
        this.toast.hide(); // moved or turned away meanwhile
        return;
      }
    }
    target ??= fallback;
    if (!target) {
      this.toast.show(NOT_FOUND, TOAST_LONG);
      return;
    }
    this.log("info", `jumping ${formatDistance(target.m)} to`, target.id);
    this.toast.hide();
    this.goTo(target, from, view);
  }

  /** There is no public hook to switch panoramas in place, so load its URL.
   * @param {Hit} target @param {PanoView} from @param {number} heading */
  goTo(target, from, heading) {
    const route = this.routes.current();
    this.leaving = from.id;
    this.routes.markJump();
    this.onLeave?.();
    this.navigator.assign(
      MapsUrl.forPanorama({
        origin: this.navigator.origin,
        search: this.navigator.search,
        target,
        fov: from.fov,
        heading,
        tilt: from.tilt,
        route,
      }),
    );
  }

  /** Strafe buttons. @param {number} turn Turn.LEFT or Turn.RIGHT */
  strafe(turn) {
    if (this.url().isStreetView && !this.searching) this.jump(turn);
  }

  /** Called every tick in Street View. `edge` is set on a walk press, `held`
   * says whether that walk button is still down. While held, every step to a
   * new panorama restarts the wait, so holding forward into a dead end works.
   * @param {string | null} edge one of WalkEdge @param {boolean} held @param {number} now */
  onWalk(edge, held, now) {
    if (edge && !this.searching) {
      const pano = this.pano();
      const jumping = pano && (this.takenOver === pano.id || this.leaving === pano.id);
      this.check =
        pano && !jumping ? { pano: pano.id, at: now + JUMP_CHECK_DELAY, back: edge === WalkEdge.BACK } : null;
    } else if (this.check && held) {
      const id = this.pano()?.id;
      if (id && id !== this.check.pano) Object.assign(this.check, { pano: id, at: now + JUMP_CHECK_DELAY });
    }
    if (this.check && now >= this.check.at) {
      const { pano, back } = this.check;
      this.check = null;
      if (this.pano()?.id === pano) this.jump(back ? Turn.BEHIND : Turn.AHEAD);
    }
  }

  /** Whether the pending walk check is for walking backwards. */
  get checkingBack() {
    return !!this.check?.back;
  }
}
