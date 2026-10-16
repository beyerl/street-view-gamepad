import { TOAST_SHORT } from "../shared/config.js";

/** Enlarges or shrinks Street View's minimap by clicking its own button. */
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
}
