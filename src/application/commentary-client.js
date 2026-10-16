// The page's side of the audio commentary: asks the background worker for
// the article nearest to the position (in commentary mode, after moving
// COMMENTARY_MOVE), and sends the commentary buttons there. Nothing plays
// until the user asks.

import { Mode } from "../domain/mode.js";
import { MapsUrl } from "../domain/maps-url.js";
import { PlaybackStatus } from "../domain/commentary-state.js";
import { COMMENTARY_MOVE, TOAST_SHORT } from "../shared/config.js";
import { Msg } from "../shared/messages.js";

/** @type {import("../presentation/hud-model.js").CommentaryView} */
const NOTHING = Object.freeze({
  available: false,
  title: "",
  status: PlaybackStatus.STOPPED,
  playingTitle: "",
  index: 0,
  count: 0,
});

export class CommentaryClient {
  /**
   * @param {{ bus: import("../ports/index.js").MessageBus, navigator: import("../ports/index.js").PageNavigator,
   *           modes: import("./mode-service.js").ModeService, toast: import("../ports/index.js").Toast,
   *           isHidden: () => boolean, onChange: () => void }} deps
   */
  constructor({ bus, navigator, modes, toast, isHidden, onChange }) {
    this.bus = bus;
    this.navigator = navigator;
    this.modes = modes;
    this.toast = toast;
    this.isHidden = isHidden;
    this.onChange = onChange;
    this.state = NOTHING;
    /** @type {import("../domain/geo.js").GeoPoint | null} where the last lookup was made */
    this.lookedUpAt = null;
    bus.on(Msg.COMMENTARY, (msg) => {
      this.state = msg.state;
      this.onChange();
    });
    bus.on(Msg.COMMENTARY_NOTICE, (msg) => {
      if (msg.message) toast.show(msg.message, msg.ms);
      else toast.hide();
    });
    modes.onChange((mode) => {
      if (mode !== Mode.COMMENTARY) return;
      this.lookedUpAt = null;
      this.lookup();
    });
  }

  /** Polled, and when the tab becomes visible. */
  lookup() {
    if (this.modes.mode !== Mode.COMMENTARY || this.isHidden()) return;
    const p = new MapsUrl(this.navigator.href).position;
    if (!p || (this.lookedUpAt && this.lookedUpAt.distanceTo(p) < COMMENTARY_MOVE)) return;
    this.lookedUpAt = p;
    this.bus.post(Msg.COMMENTARY_AT, { lat: p.lat, lng: p.lng });
  }

  toggle() {
    if (!this.state.available && this.state.status === PlaybackStatus.STOPPED) {
      this.toast.show("No commentary for this place.", TOAST_SHORT);
      return;
    }
    this.bus.post(Msg.COMMENTARY_TOGGLE);
  }

  /** Next / previous of the articles nearby. Outside commentary mode this
   * switches to it first, which looks up what is nearby. @param {number} step */
  next(step) {
    if (this.modes.mode !== Mode.COMMENTARY) this.modes.set(Mode.COMMENTARY);
    else if (this.state.count > 1) this.bus.post(Msg.COMMENTARY_NEXT, { step });
    else
      this.toast.show(this.state.available ? "No other article nearby." : "No commentary for this place.", TOAST_SHORT);
  }

  /** The tab was hidden: pause what plays. */
  pause() {
    this.bus.post(Msg.COMMENTARY_PAUSE);
  }
}
