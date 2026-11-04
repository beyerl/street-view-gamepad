// Composition root of the bridge: a content script in the isolated world
// that connects the page script to the extension: settings from
// chrome.storage, and messages to and from the background worker.

import { withDefaults } from "../domain/settings.js";
import { VisitState } from "../domain/visit.js";
import { WindowMessageBus } from "../infrastructure/window-message-bus.js";
import { FORWARDED, Msg, RELAYED, Source } from "../shared/messages.js";
import { StorageKey } from "../shared/storage-keys.js";

/** @param {{ window: Window, chrome: typeof globalThis.chrome }} g */
export function startBridge({ window, chrome }) {
  const bus = new WindowMessageBus(window, { send: Source.BRIDGE, accept: Source.PAGE });
  const pushSettings = async () =>
    bus.post(Msg.SETTINGS, { settings: withDefaults(await chrome.storage.sync.get(null)) });

  // Virtual Visit: the stop in progress lives in chrome.storage.local, where
  // the game's page reads it back (entry/visit-link.js).
  const local = chrome.storage.local;
  /** @returns {Promise<import("../domain/visit.js").Visit | null>} */
  const getVisit = async () =>
    /** @type {import("../domain/visit.js").Visit | null} */ (
      (await local.get(StorageKey.VISIT))[StorageKey.VISIT] ?? null
    );
  /** @param {(v: import("../domain/visit.js").Visit) => Partial<import("../domain/visit.js").Visit>} change */
  const updateVisit = async (change) => {
    const v = await getVisit();
    if (!v || v.finished) return null;
    const next = { ...v, ...change(v) };
    await local.set({ [StorageKey.VISIT]: next });
    return next;
  };
  const pushVisit = async () => bus.post(Msg.VISIT, { visit: await getVisit() });
  bus.on(Msg.GET_VISIT, pushVisit);
  bus.on(Msg.VISIT_ENTERED, () => updateVisit(() => ({ state: VisitState.VISITING })));
  bus.on(Msg.VISIT_MOVED, (m) => updateVisit(() => ({ position: m.position })));
  bus.on(Msg.VISIT_FINISH, async () => {
    const v = await updateVisit(() => ({ finished: true }));
    if (v) window.location.assign(v.returnUrl);
  });

  for (const [type, fields] of Object.entries(FORWARDED)) {
    bus.on(type, (m) => chrome.runtime.sendMessage({ type, ...Object.fromEntries(fields.map((f) => [f, m[f]])) }));
  }
  bus.on(Msg.GET_SETTINGS, pushSettings);

  // Leaving the page (navigation, reload): stop this tab's sound. Sent from
  // here so it doesn't depend on a postMessage hop.
  window.addEventListener("pagehide", () => chrome.runtime.sendMessage({ type: Msg.AMBIENT_STOP }));

  // Commentary state and notices from the background worker.
  chrome.runtime.onMessage.addListener((msg) => {
    if (RELAYED.includes(msg?.type)) bus.post(msg.type, msg);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") pushSettings();
    if (area === "local" && StorageKey.VISIT in changes) pushVisit();
  });
  pushSettings();
  pushVisit();
}
