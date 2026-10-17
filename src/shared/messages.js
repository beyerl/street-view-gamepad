// Every message passed between the extension's contexts. Pages and the bridge
// talk with window.postMessage, everything else with chrome.runtime / tabs.
//
//   page (inject, MAIN world) <-> bridge (content script) <-> background <-> offscreen

/** `source` of window messages, so each side ignores the page's own messages. */
export const Source = Object.freeze({
  PAGE: "sv-gamepad", // from the page script
  BRIDGE: "sv-gamepad-bridge", // from the bridge
});

/** Types of messages between the page, the bridge and the background worker. */
export const Msg = Object.freeze({
  // page -> bridge
  GET_SETTINGS: "getSettings",
  // page -> background (forwarded by the bridge)
  TOGGLE_FULLSCREEN: "toggleFullscreen",
  AMBIENT: "ambient",
  AMBIENT_STOP: "ambientStop",
  COMMENTARY_AT: "commentaryAt",
  COMMENTARY_TOGGLE: "commentaryToggle",
  COMMENTARY_PAUSE: "commentaryPause",
  COMMENTARY_NEXT: "commentaryNext",
  // bridge -> page
  SETTINGS: "settings",
  // background -> page (relayed by the bridge)
  COMMENTARY: "commentary",
  COMMENTARY_NOTICE: "commentaryNotice",
  // offscreen -> background
  COMMENTARY_ENDED: "commentaryEnded",
  COMMENTARY_LOADING: "commentaryLoading",
});

/**
 * Page messages the bridge forwards to the background worker, with the payload
 * fields each one carries.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const FORWARDED = Object.freeze({
  [Msg.TOGGLE_FULLSCREEN]: [],
  [Msg.AMBIENT]: ["lat", "lng"],
  [Msg.AMBIENT_STOP]: [],
  [Msg.COMMENTARY_AT]: ["lat", "lng"],
  [Msg.COMMENTARY_TOGGLE]: [],
  [Msg.COMMENTARY_PAUSE]: [],
  [Msg.COMMENTARY_NEXT]: ["step"],
});

/** Background messages the bridge relays to the page. */
export const RELAYED = Object.freeze([Msg.COMMENTARY, Msg.COMMENTARY_NOTICE]);

/** Messages from the background worker to the offscreen document. */
export const OffscreenMsg = Object.freeze({
  TARGET: "offscreen", // value of `target`, so other contexts ignore these
  PLAY: "play",
  PAUSE: "pause",
  VOLUME: "volume",
  STATUS: "status",
  COMMENTARY_PLAY: "commentaryPlay",
  COMMENTARY_SPEAK: "commentarySpeak",
  COMMENTARY_PRELOAD: "commentaryPreload",
  COMMENTARY_PAUSE: "commentaryPause",
  COMMENTARY_RESUME: "commentaryResume",
  COMMENTARY_STOP: "commentaryStop",
});
