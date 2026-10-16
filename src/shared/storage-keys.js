// Keys of everything the extension stores.

/** The page's sessionStorage: per tab, survives the reload a jump causes. */
export const SessionKey = Object.freeze({
  MODE: "svgp-mode",
  OVERLAY_HIDDEN: "svgp-overlay-hidden",
  ROUTE: "svgp-route",
  JUMPED: "svgp-jumped", // set just before a jump reloads the page
});

/** chrome.storage.session (background) and chrome.storage.local. */
export const StorageKey = Object.freeze({
  NOW_PLAYING: "nowPlaying", // session: attribution of the ambient recording, shown in the popup
  APOREE_LOCATIONS: "aporeeLocations", // local: all recording locations, cached for a week
  /** session: window state before entering fullscreen */
  prevWindowState: (/** @type {number} */ windowId) => `prevState:${windowId}`,
});
