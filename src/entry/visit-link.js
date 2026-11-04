// Composition root of the content script on the Virtual Visit game's page
// (isolated world). The game hands a stop over before it opens Google Maps;
// we keep it in chrome.storage.local, where the Maps page (bridge.js) marks
// moves and the finish, and report it back whenever the game asks or it
// changes. See domain/visit.js for the protocol.

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

  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.data?.source !== Source.GAME) return;
    const { type } = e.data;
    if (type === VisitMsg.HELLO) await pushState();
    else if (type === VisitMsg.START) {
      const visit = acceptTicket(e.data.ticket, origin, now());
      if (visit) await local.set({ [StorageKey.VISIT]: visit });
      post(VisitMsg.STARTED, { ok: !!visit });
    } else if (type === VisitMsg.CLEAR) await local.remove(StorageKey.VISIT);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && StorageKey.VISIT in changes) pushState();
  });
  pushState();
}
