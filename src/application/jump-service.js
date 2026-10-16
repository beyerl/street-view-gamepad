// User-contributed photospheres usually have no links to their neighbours, so
// walking does nothing there. Whenever the view direction changes, look up the
// nearest panorama roughly ahead and show its distance. If the panorama hasn't
// changed shortly after a walk press, go there. Strafing jumps to the side.

import { formatDistance, Heading } from "../domain/geo.js";
import { MapsUrl } from "../domain/maps-url.js";
import {
  AHEAD_DELAY,
  AHEAD_REUSE_ANGLE,
  JUMP_CHECK_DELAY,
  JUMP_MAX_ANGLE,
  JUMP_SEARCH_WIDTH,
  JUMP_STEPS,
  TOAST_LONG,
} from "../shared/config.js";

export const Turn = Object.freeze({ AHEAD: 0, BEHIND: 180, LEFT: -90, RIGHT: 90 });
export const WalkEdge = Object.freeze({ FORWARD: "fwd", BACK: "back" });

const SEARCHING = "Searching for the next Street View point…";
const NOT_FOUND = "No Street View point found in this direction.";

/**
 * @typedef {import("../domain/maps-url.js").PanoView} PanoView
 * @typedef {import("../domain/maps-url.js").PanoTarget & { m: number }} Hit
 */

export class JumpService {
  /**
   * @param {{ panoramas: import("../ports/index.js").PanoramaRepository, navigator: import("../ports/index.js").PageNavigator,
   *           routes: import("./route-keeper.js").RouteKeeper, scheduler: import("../ports/index.js").Scheduler,
   *           toast: import("../ports/index.js").Toast, hint: { show(text: string): void },
   *           log: (level: string, ...a: any[]) => void }} deps
   */
  constructor({ panoramas, navigator, routes, scheduler, toast, hint, log }) {
    this.panoramas = panoramas;
    this.navigator = navigator;
    this.routes = routes;
    this.scheduler = scheduler;
    this.toast = toast;
    this.hint = hint;
    this.log = log;
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

  /** Search circles centred ever farther ahead, each about as wide as its
   * distance, and keep the nearest hit that lies in the direction.
   * @param {PanoView} from @param {number} heading @returns {Promise<Hit | null>} */
  async findAhead(from, heading) {
    const hits = await Promise.all(
      JUMP_STEPS.map((d) =>
        this.panoramas.nearest(from.point.offset(heading, d), d * JUMP_SEARCH_WIDTH).catch((err) => {
          this.log("info", err);
          return null;
        }),
      ),
    );
    /** @type {Hit | null} */
    let best = null;
    for (const p of hits) {
      if (!p || p.id === from.id) continue;
      const { m, bearing } = from.point.to(p);
      if (m < 1 || Heading.diff(bearing, heading) > JUMP_MAX_ANGLE) continue;
      if (!best || m < best.m) best = { ...p, m };
    }
    return best;
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

  cancel() {
    this.check = null;
    this.search++;
    if (this.searching) this.toast.hide();
    this.searching = false;
  }

  /** Go to the next point `turn`° off the view direction, reusing the lookup
   * shown in the hint when it still matches the view. Stepping to the side
   * keeps the view direction; walking looks the way it went. @param {number} turn */
  async jump(turn) {
    const from = this.pano();
    if (!from) return;
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
    this.routes.markJump();
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
      this.check = pano && { pano: pano.id, at: now + JUMP_CHECK_DELAY, back: edge === WalkEdge.BACK };
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
