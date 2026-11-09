// Keys of everything the extension stores.

/** The page's sessionStorage: per tab, survives the reload a jump causes. */
export const SessionKey = Object.freeze({
  MODE: "svgp-mode",
  OVERLAY_HIDDEN: "svgp-overlay-hidden",
  ROUTE: "svgp-route",
  JUMPED: "svgp-jumped", // set just before a jump reloads the page
  VISIT_GREETED: "svgp-visit-greeted", // the Virtual Visit stop whose hint was shown
  VISIT_TAB: "svgp-visit-tab", // the Virtual Visit stop this tab was sent to play
  USER_PHOTOS_OFF: "svgp-user-photos-off", // "1": jumps skip user-contributed photos
  MINIMAP_WIDTH: "svgp-minimap-width", // px, set just before a jump reloads the page
  MINIMAP_ZOOM: "svgp-minimap-zoom", // steps zoomed in (+) or out (-), set just before a jump
  INDOORS: "svgp-indoors", // "1": the last panorama was on a floor of a building
});

/** chrome.storage.session (background) and chrome.storage.local. */
export const StorageKey = Object.freeze({
  NOW_PLAYING: "nowPlaying", // session: attribution of the ambient recording, shown in the popup
  APOREE_LOCATIONS: "aporeeLocations", // local: all recording locations, cached for a week
  VISIT: "virtualVisit", // local: the Virtual Visit stop in progress (see domain/visit.js)
  SETTINGS_UPDATED_AT: "settingsUpdatedAt", // sync: ms of the last change, compared with the game's (see visit-link.js)
  /** session: window state before entering fullscreen */
  prevWindowState: (/** @type {number} */ windowId) => `prevState:${windowId}`,
});
