// Composition root of the content script on the Virtual Visit game's page
// (isolated world). The game hands a stop over before it opens Google Maps;
// we keep it in chrome.storage.local, where the Maps page (bridge.js) marks
// moves and the finish, and report it back whenever the game asks or it
// changes. See domain/visit.js for the protocol.
//
// It also syncs the settings with the game. The game keeps them in its
// localStorage, the single source of truth once it has them; the extension's
// other pages can't read that (another origin), so chrome.storage.sync mirrors
// it for them. Each side stamps its changes, and the newer side wins, so a
// change made in the popup while the game was closed isn't lost.
//   vv-settings { settings, updatedAt }  in both directions

import { DEFAULT_SETTINGS, sanitizeSettings, settingsOf } from "../domain/settings.js";
import { acceptTicket } from "../domain/visit.js";
import { Source, VisitMsg } from "../shared/messages.js";
import { StorageKey } from "../shared/storage-keys.js";

/** @param {{ window: Window, chrome: typeof globalThis.chrome, now: () => number }} g */
export function startVisitLink({ window, chrome, now }) {
  const local = chrome.storage.local;
  const origin = window.location.origin;
  /** @param {string} type @param {Record<string, unknown>} [payload] */
  const post = (type, payload = {}) => window.postMessage({ source: Source.VISIT_LINK, type, ...payload }, origin);
  const pushState = async () =>
    post(VisitMsg.STATE, {
      version: chrome.runtime.getManifest().version,
      ticket: (await local.get(StorageKey.VISIT))[StorageKey.VISIT] ?? null,
    });

  const sync = chrome.storage.sync;
  const STAMP = StorageKey.SETTINGS_UPDATED_AT;
  const pushSettings = async () => {
    const stored = await sync.get(null);
    post(VisitMsg.SETTINGS, { settings: settingsOf(stored), updatedAt: stored[STAMP] ?? 0 });
  };
  /** @param {unknown} data @param {unknown} updatedAt */
  const takeSettings = async (data, updatedAt) => {
    const settings = sanitizeSettings(data);
    if (!settings || typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return;
    const stored = await sync.get(STAMP);
    if (updatedAt <= /** @type {number} */ (stored[STAMP] ?? 0)) return;
    await sync.set({ ...settings, [STAMP]: updatedAt }).catch(() => {}); // over the quota: the game still has them
  };

  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.data?.source !== Source.GAME) return;
    const { type } = e.data;
    if (type === VisitMsg.HELLO) {
      await pushState();
      await pushSettings();
    } else if (type === VisitMsg.SETTINGS) await takeSettings(e.data.settings, e.data.updatedAt);
    else if (type === VisitMsg.START) {
      const visit = acceptTicket(e.data.ticket, origin, now());
      if (visit) await local.set({ [StorageKey.VISIT]: visit });
      post(VisitMsg.STARTED, { ok: !!visit });
    } else if (type === VisitMsg.CLEAR) await local.remove(StorageKey.VISIT);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && StorageKey.VISIT in changes) pushState();
    if (area === "sync" && (STAMP in changes || Object.keys(changes).some((k) => k in DEFAULT_SETTINGS)))
      pushSettings();
  });
  pushState();
}
