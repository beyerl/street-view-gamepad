// The modes the mode select button cycles through, and what the three mode
// buttons do in each.

export const Mode = Object.freeze({
  LEVELS: "levels",
  COMMENTARY: "commentary",
  BROWSER: "browser",
  MINIMAP: "minimap",
});
/** @type {readonly string[]} */
export const MODES = Object.freeze([Mode.LEVELS, Mode.COMMENTARY, Mode.BROWSER, Mode.MINIMAP]);

/** @param {string} mode */
export const nextMode = (mode) => MODES[(MODES.indexOf(mode) + 1) % MODES.length];
/** @param {unknown} m @returns {m is string} */
export const isMode = (m) => typeof m === "string" && MODES.includes(m);

/** What a mode button can do. */
export const ModeCommand = Object.freeze({
  LEVEL_UP: "levelUp",
  LEVEL_DOWN: "levelDown",
  PLAY_PAUSE: "playPause",
  ARTICLE_NEXT: "articleNext",
  ARTICLE_PREV: "articlePrev",
  FULLSCREEN: "fullscreen",
  OVERLAY: "overlay",
  HISTORY_BACK: "historyBack",
  MINIMAP_TOGGLE: "minimapToggle",
  MINIMAP_ZOOM_IN: "minimapZoomIn",
  MINIMAP_ZOOM_OUT: "minimapZoomOut",
});

/** Commands that repeat while their button is held. @type {ReadonlySet<string>} */
export const REPEATING = Object.freeze(new Set([ModeCommand.MINIMAP_ZOOM_IN, ModeCommand.MINIMAP_ZOOM_OUT]));

/** @typedef {{ name: string, buttons: readonly (string | null)[] }} ModeDef */

/** Per mode, its name and the commands of mode buttons 1, 2 and 3.
 * @type {Readonly<Record<string, ModeDef>>} */
export const MODE_TABLE = Object.freeze({
  [Mode.LEVELS]: { name: "Multilayer", buttons: [ModeCommand.LEVEL_UP, null, ModeCommand.LEVEL_DOWN] },
  [Mode.COMMENTARY]: {
    name: "Wikiaudio",
    buttons: [ModeCommand.PLAY_PAUSE, ModeCommand.ARTICLE_NEXT, ModeCommand.ARTICLE_PREV],
  },
  [Mode.BROWSER]: {
    name: "Browser",
    buttons: [ModeCommand.FULLSCREEN, ModeCommand.OVERLAY, ModeCommand.HISTORY_BACK],
  },
  [Mode.MINIMAP]: {
    name: "Minimap",
    buttons: [ModeCommand.MINIMAP_TOGGLE, ModeCommand.MINIMAP_ZOOM_IN, ModeCommand.MINIMAP_ZOOM_OUT],
  },
});

/** For the key mapping window. @type {Readonly<Record<string, string>>} */
export const COMMAND_LABELS = Object.freeze({
  [ModeCommand.LEVEL_UP]: "One floor up",
  [ModeCommand.LEVEL_DOWN]: "One floor down",
  [ModeCommand.PLAY_PAUSE]: "Play / pause",
  [ModeCommand.ARTICLE_NEXT]: "Next article",
  [ModeCommand.ARTICLE_PREV]: "Previous article",
  [ModeCommand.FULLSCREEN]: "Fullscreen",
  [ModeCommand.OVERLAY]: "Hide / show search bar",
  [ModeCommand.HISTORY_BACK]: "Browser back",
  [ModeCommand.MINIMAP_TOGGLE]: "Enlarge / shrink",
  [ModeCommand.MINIMAP_ZOOM_IN]: "Zoom in",
  [ModeCommand.MINIMAP_ZOOM_OUT]: "Zoom out",
});

/** The command of mode button `index` (0-2) in `mode`, or null. @param {string} mode @param {number} index */
export const modeCommand = (mode, index) => MODE_TABLE[mode]?.buttons[index] ?? null;
