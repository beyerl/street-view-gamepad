// Keepsakes of a Virtual Visit: a screenshot of the tab, saved to the Downloads
// folder, and a bookmark of the current view. Done by the background worker,
// the only context with these APIs.

import { Msg } from "../shared/messages.js";

export const VISIT_FOLDER = "Virtual Visit";

/** @param {Date} d local time, safe in a file name */
const stamp = (d) => {
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

export class KeepsakeService {
  /**
   * @param {{ tabs: typeof chrome.tabs, downloads: typeof chrome.downloads, bookmarks: typeof chrome.bookmarks,
   *           now: () => number, warn: (...a: any[]) => void }} deps
   */
  constructor({ tabs, downloads, bookmarks, now, warn }) {
    this.tabs = tabs;
    this.downloads = downloads;
    this.bookmarks = bookmarks;
    this.now = now;
    this.warn = warn;
  }

  /** @param {chrome.tabs.Tab} tab @param {string} message */
  notify(tab, message) {
    if (tab.id !== undefined) this.tabs.sendMessage(tab.id, { type: Msg.TOAST, message })?.catch?.(() => {});
  }

  /** @param {chrome.tabs.Tab} tab */
  async screenshot(tab) {
    try {
      const url = await this.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      await this.downloads.download({
        url,
        filename: `${VISIT_FOLDER}/Street View ${stamp(new Date(this.now()))}.png`,
        conflictAction: "uniquify",
      });
      this.notify(tab, "Screenshot saved");
    } catch (e) {
      this.warn("screenshot failed", e);
      this.notify(tab, "Screenshot failed");
    }
  }

  /** @param {chrome.tabs.Tab} tab */
  async bookmark(tab) {
    try {
      const folder = await this.folder();
      const existing = await this.bookmarks.getChildren(folder.id);
      if (existing.some((b) => b.url === tab.url)) return this.notify(tab, "Already bookmarked");
      await this.bookmarks.create({ parentId: folder.id, title: tab.title || "Street View", url: tab.url });
      this.notify(tab, `Bookmarked in "${VISIT_FOLDER}"`);
    } catch (e) {
      this.warn("bookmark failed", e);
      this.notify(tab, "Bookmark failed");
    }
  }

  /** The bookmark folder, whatever its capitalisation and wherever it is; created if missing. */
  async folder() {
    const hits = await this.bookmarks.search(VISIT_FOLDER);
    return (
      hits.find((b) => !b.url && b.title.toLowerCase() === VISIT_FOLDER.toLowerCase()) ??
      (await this.bookmarks.create({ title: VISIT_FOLDER }))
    );
  }
}
