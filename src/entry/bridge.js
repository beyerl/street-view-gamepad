// Composition root of the bridge: a content script in the isolated world
// that connects the page script to the extension: settings from
// chrome.storage, and messages to and from the background worker.

import { withDefaults } from "../domain/settings.js";
import { WindowMessageBus } from "../infrastructure/window-message-bus.js";
import { FORWARDED, Msg, RELAYED, Source } from "../shared/messages.js";

/** @param {{ window: Window, chrome: typeof globalThis.chrome }} g */
export function startBridge({ window, chrome }) {
  const bus = new WindowMessageBus(window, { send: Source.BRIDGE, accept: Source.PAGE });
  const pushSettings = async () =>
    bus.post(Msg.SETTINGS, { settings: withDefaults(await chrome.storage.sync.get(null)) });

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

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") pushSettings();
  });
  pushSettings();
}
