import { StorageKey } from "../shared/storage-keys.js";

/** Puts the browser window into fullscreen and back. Done by the background
 * worker because gamepad input is no user gesture, so the page itself may not
 * call requestFullscreen(). */
export class FullscreenService {
  /** @param {typeof globalThis.chrome.windows} windows @param {chrome.storage.StorageArea} session remembers the state before */
  constructor(windows, session) {
    this.windows = windows;
    this.session = session;
  }

  /** @param {number} windowId */
  async toggle(windowId) {
    const win = await this.windows.get(windowId);
    const key = StorageKey.prevWindowState(windowId);
    if (win.state === "fullscreen") {
      const { [key]: prev } = await this.session.get(key);
      await this.windows.update(windowId, { state: /** @type {any} */ (prev || "normal") });
      await this.session.remove(key);
    } else {
      await this.session.set({ [key]: win.state });
      await this.windows.update(windowId, { state: "fullscreen" });
    }
  }
}
