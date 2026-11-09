// Every message passed between the extension's contexts. Pages and the bridge
// talk with window.postMessage, everything else with chrome.runtime / tabs.
//
//   page (inject, MAIN world) <-> bridge (content script) <-> background <-> offscreen

/** `source` of window messages, so each side ignores the page's own messages. */
export const Source = Object.freeze({
  PAGE: "sv-gamepad", // from the page script
  BRIDGE: "sv-gamepad-bridge", // from the bridge
  GAME: "virtual-visit", // from the Virtual Visit game's page
  VISIT_LINK: "sv-gamepad-visit", // from our content script on that page
});

/** Messages between the Virtual Visit game and our content script on its page (see domain/visit.js). */
export const VisitMsg = Object.freeze({
  HELLO: "vv-hello", // game: is the extension there? answered with STATE
  SETTINGS: "vv-settings", // both ways: the settings and when they last changed
  START: "vv-start", // game: a visit begins (ticket), answered with STARTED
  CLEAR: "vv-clear", // game: the visit was taken over, forget it
  STATE: "vv-state", // extension: the stored visit (or null) and our version
  STARTED: "vv-started",
});

/** Types of messages between the page, the bridge and the background worker. */
export const Msg = Object.freeze({
  // page -> bridge
  GET_SETTINGS: "getSettings",
  GET_VISIT: "getVisit",
  VISIT_ENTERED: "visitEntered", // Street View is open for the visit
  VISIT_MOVED: "visitMoved", // { position }
  VISIT_FINISH: "visitFinish", // L + R: back to the game
  // bridge -> page
  VISIT: "visit", // { visit } the running Virtual Visit stop, or null
  // page -> background (forwarded by the bridge)
  TOGGLE_FULLSCREEN: "toggleFullscreen",
  SCREENSHOT: "screenshot",
  BOOKMARK: "bookmark",
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
  TOAST: "toast", // { message }
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
  [Msg.SCREENSHOT]: [],
  [Msg.BOOKMARK]: [],
  [Msg.AMBIENT]: ["lat", "lng"],
  [Msg.AMBIENT_STOP]: [],
  [Msg.COMMENTARY_AT]: ["lat", "lng"],
  [Msg.COMMENTARY_TOGGLE]: [],
  [Msg.COMMENTARY_PAUSE]: [],
  [Msg.COMMENTARY_NEXT]: ["step"],
});

/** Background messages the bridge relays to the page. */
export const RELAYED = Object.freeze([Msg.COMMENTARY, Msg.COMMENTARY_NOTICE, Msg.TOAST]);

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
