import { isMode, Mode, nextMode } from "../domain/mode.js";
import { SessionKey } from "../shared/storage-keys.js";

/** The current mode, remembered for the tab (it survives the reload a jump causes). */
export class ModeService {
  /** @param {import("../ports/index.js").KeyValueStore} store @param {(level: string, ...a: any[]) => void} log */
  constructor(store, log) {
    this.store = store;
    this.log = log;
    const saved = store.get(SessionKey.MODE);
    /** @type {string} */
    this.mode = isMode(saved) ? saved : Mode.LEVELS;
    /** @type {((mode: string) => void)[]} */
    this.listeners = [];
  }

  /** @param {(mode: string) => void} fn */
  onChange(fn) {
    this.listeners.push(fn);
  }

  next() {
    this.set(nextMode(this.mode));
  }

  /** @param {string} mode */
  set(mode) {
    this.mode = mode;
    this.store.set(SessionKey.MODE, mode);
    this.log("info", "mode:", mode);
    for (const fn of this.listeners) fn(mode);
  }
}
