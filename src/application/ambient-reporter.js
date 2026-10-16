import { MapsUrl } from "../domain/maps-url.js";
import { Msg } from "../shared/messages.js";

/** Reports the position in the URL to the background worker, which plays the
 * nearest field recording; positions are rounded to ~10 m so walking only
 * triggers a lookup per step. Stops the sound without a position, with sound
 * off, or in a hidden tab. */
export class AmbientReporter {
  /**
   * @param {{ bus: import("../ports/index.js").MessageBus, navigator: import("../ports/index.js").PageNavigator,
   *           settings: { soundEnabled: boolean }, isHidden: () => boolean }} deps
   */
  constructor({ bus, navigator, settings, isHidden }) {
    this.bus = bus;
    this.navigator = navigator;
    this.settings = settings;
    this.isHidden = isHidden;
    /** @type {string | null} "" = unknown, so the first check always reports; null = stopped */
    this.key = "";
  }

  update() {
    const p = new MapsUrl(this.navigator.href).position;
    if (this.settings.soundEnabled && p && !this.isHidden()) {
      if (p.key() === this.key) return;
      this.key = p.key();
      this.bus.post(Msg.AMBIENT, { lat: p.lat, lng: p.lng });
    } else if (this.key !== null) {
      this.key = null;
      this.bus.post(Msg.AMBIENT_STOP);
    }
  }
}
