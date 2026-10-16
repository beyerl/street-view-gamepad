import { levelTarget } from "../domain/levels.js";
import { LEVEL_RENDER_DELAY, TOAST_SHORT } from "../shared/config.js";

/** Switches floors in places with a floor picker, such as big stations. */
export class LevelService {
  /**
   * @param {{ page: import("../infrastructure/google-maps-dom.js").GoogleMapsDom, toast: import("../ports/index.js").Toast,
   *           scheduler: import("../ports/index.js").Scheduler, onSwitched: () => void, log: (level: string, ...a: any[]) => void }} deps
   */
  constructor({ page, toast, scheduler, onSwitched, log }) {
    this.page = page;
    this.toast = toast;
    this.scheduler = scheduler;
    this.onSwitched = onSwitched;
    this.log = log;
  }

  /** @param {number} step LevelStep.UP or LevelStep.DOWN */
  switch(step) {
    const picker = this.page.findLevelPicker();
    if (!picker) {
      this.toast.show("No floors to switch between here.", TOAST_SHORT);
      return;
    }
    const { items, current } = picker;
    const target = items[levelTarget(items.length, current, step)];
    this.log(
      "debug",
      `levels [${items.map((it) => it.label)}], current ${items[current]?.label ?? "?"} -> ${target.label}`,
    );
    this.page.lastLevel = target.label;
    this.page.click(target.el);
    this.scheduler.after(LEVEL_RENDER_DELAY, this.onSwitched);
  }

  /** The current floor's label, "" if unknown, null without a floor picker. */
  floor() {
    const picker = this.page.findLevelPicker();
    return picker ? (picker.items[picker.current]?.label ?? "") : null;
  }
}
