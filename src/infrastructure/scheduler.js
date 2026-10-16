// One timer for all the page's polling: every(ms) tasks run from a single
// base tick instead of a setInterval each.

import { Scheduler } from "../ports/index.js";

/** @implements {Scheduler} */
export class TickScheduler extends Scheduler {
  /**
   * @param {{ setInterval: typeof setInterval, setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout,
   *           now: () => number }} timers
   * @param {number} tickMs the base tick; every() periods are rounded up to it
   */
  constructor(timers, tickMs) {
    super();
    this.timers = timers;
    this.tickMs = tickMs;
    /** @type {{ ms: number, fn: () => void, next: number }[]} */
    this.tasks = [];
    this.started = false;
  }

  every(/** @type {number} */ ms, /** @type {() => void} */ fn) {
    this.tasks.push({ ms, fn, next: this.now() + ms });
    if (!this.started) {
      this.started = true;
      this.timers.setInterval(() => this.run(), this.tickMs);
    }
  }

  run() {
    const now = this.now();
    for (const t of this.tasks) {
      if (now < t.next) continue;
      t.next += t.ms;
      if (t.next <= now) t.next = now + t.ms; // fell behind (stalled tab): don't catch up
      t.fn();
    }
  }

  after(/** @type {number} */ ms, /** @type {() => void} */ fn) {
    return this.timers.setTimeout(fn, ms);
  }

  cancel(/** @type {any} */ handle) {
    this.timers.clearTimeout(handle);
  }

  now() {
    return this.timers.now();
  }
}
