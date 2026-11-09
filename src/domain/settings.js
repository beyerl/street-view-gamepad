import { ACTIONS, defaultButtonMap, normalizeButtonMap } from "./actions.js";
import { isBinding } from "./binding.js";

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

const LOOK_SPEED = /** @type {[number, number]} */ ([100, 2400]);
const PERCENT = /** @type {[number, number]} */ ([0, 100]);
const RANGES = Object.freeze({
  lookSpeedX: LOOK_SPEED,
  lookSpeedY: LOOK_SPEED,
  masterVolume: PERCENT,
  volume: PERCENT,
  commentaryVolume: PERCENT,
});

/** Just the settings of what chrome.storage.sync holds, complete. @param {Record<string, any>} [stored] @returns {Settings} */
export function settingsOf(stored = {}) {
  const all = withDefaults(stored);
  return /** @type {Settings} */ (Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, all[k]])));
}

/**
 * The valid settings in a message from the game's page, which is not trusted.
 * @param {any} data @returns {Partial<Settings> | null} null if none are valid
 */
export function sanitizeSettings(data) {
  if (!data || typeof data !== "object") return null;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const v = data[key];
    if (typeof v === "number" && v >= min && v <= max) out[key] = v;
  }
  if (typeof data.soundEnabled === "boolean") out.soundEnabled = data.soundEnabled;
  if (Object.values(LogLevel).includes(data.logLevel)) out.logLevel = data.logLevel;
  if (data.buttonMap && typeof data.buttonMap === "object") {
    const entries = ACTIONS.filter((a) => isBinding(data.buttonMap[a.id])).map((a) => [a.id, data.buttonMap[a.id]]);
    if (entries.length === ACTIONS.length) out.buttonMap = Object.fromEntries(entries);
  }
  return Object.keys(out).length ? out : null;
}
