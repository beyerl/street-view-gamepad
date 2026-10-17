import { TOAST_SHORT, WHEEL_STEP } from "../shared/config.js";

/** Enlarges or shrinks Street View's minimap by clicking its own button, and
 * zooms it with the mouse wheel. */
export class MinimapService {
  /** @param {import("../ports/index.js").MapsPage} page @param {import("../ports/index.js").Toast} toast */
  constructor(page, toast) {
    this.page = page;
    this.toast = toast;
  }

  toggle() {
    const map = this.page.minimap();
    const button = map && this.page.minimapSizeButton(map);
    if (button) this.page.click(button);
    else this.toast.show("No minimap here.", TOAST_SHORT);
  }

  /** @param {number} step +1 zooms in, -1 out */
  zoom(step) {
    const map = this.page.minimap();
    if (map) this.page.wheel(map, -step * WHEEL_STEP);
    else this.toast.show("No minimap here.", TOAST_SHORT);
  }
}
