import { SessionKey } from "../shared/storage-keys.js";
import { TOAST_SHORT } from "../shared/config.js";

/** Whether jumps may land on user-contributed photos; remembered for the tab.
 * Where Google's own imagery is dense, they mostly get in the way. */
export class UserPhotosService {
  /**
   * @param {{ store: import("../ports/index.js").KeyValueStore, toast: import("../ports/index.js").Toast,
   *           onChange: () => void, log: (level: string, ...a: any[]) => void }} deps
   */
  constructor({ store, toast, onChange, log }) {
    this.store = store;
    this.toast = toast;
    this.onChange = onChange;
    this.log = log;
    this.allowed = store.get(SessionKey.USER_PHOTOS_OFF) !== "1";
  }

  toggle() {
    this.allowed = !this.allowed;
    this.store.set(SessionKey.USER_PHOTOS_OFF, this.allowed ? "" : "1");
    this.log("info", this.allowed ? "user photos allowed" : "user photos skipped");
    this.toast.show(this.allowed ? "User photos: allowed" : "User photos: skipped, Google's only", TOAST_SHORT);
    this.onChange();
  }
}
