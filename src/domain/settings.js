import { defaultButtonMap, normalizeButtonMap } from "./actions.js";

export const LogLevel = Object.freeze({ OFF: "off", INFO: "info", DEBUG: "debug" });
const LOG_RANK = { [LogLevel.OFF]: 0, [LogLevel.INFO]: 1, [LogLevel.DEBUG]: 2 };

/** True if a message of `level` is shown at the configured `setting`. */
export const logEnabled = (/** @type {string} */ setting, /** @type {string} */ level) =>
  (LOG_RANK[setting] ?? LOG_RANK[LogLevel.INFO]) >= LOG_RANK[level];

/**
 * @typedef {object} Settings
 * @property {number} lookSpeedX px/s of simulated mouse drag while a look button is held
 * @property {number} lookSpeedY
 * @property {string} logLevel one of LogLevel
 * @property {boolean} soundEnabled ambient field recording nearest to the location
 * @property {number} masterVolume 0-100, scales both of the following
 * @property {number} volume 0-100, soundscape (ambient recordings)
 * @property {number} commentaryVolume 0-100, spoken articles
 * @property {Record<string, import("./actions.js").BindingValue>} buttonMap action -> binding
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  lookSpeedX: 720,
  lookSpeedY: 480,
  logLevel: LogLevel.INFO,
  soundEnabled: true,
  masterVolume: 100,
  volume: 50,
  commentaryVolume: 100,
  buttonMap: Object.freeze(defaultButtonMap()),
});

/** Stored settings completed with the defaults, including actions added since they were stored.
 * @param {Partial<Settings>} [stored] @returns {Settings} */
export function withDefaults(stored = {}) {
  return { ...DEFAULT_SETTINGS, ...stored, buttonMap: normalizeButtonMap(stored.buttonMap) };
}

/** Effective 0-1 volumes: each slider scaled by the master volume.
 * @param {Pick<Settings, "masterVolume" | "volume" | "commentaryVolume">} s */
export function effectiveVolumes(s) {
  return {
    ambient: (s.masterVolume / 100) * (s.volume / 100),
    commentary: (s.masterVolume / 100) * (s.commentaryVolume / 100),
  };
}
