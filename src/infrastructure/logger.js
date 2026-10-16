import { logEnabled } from "../domain/settings.js";

const PREFIX = "[Street View Gamepad]";

/** A log function that honours the log level setting.
 * @param {{ log: (...args: any[]) => void }} console @param {() => string} level the current setting
 * @returns {(level: string, ...args: any[]) => void} */
export const makeLogger =
  (console, level) =>
  (msgLevel, ...args) => {
    if (logEnabled(level(), msgLevel)) console.log(PREFIX, ...args);
  };

/** Unconditional, for the background worker. @param {{ log: (...args: any[]) => void }} console */
export const plainLogger =
  (console) =>
  (/** @type {any[]} */ ...args) =>
    console.log(PREFIX, ...args);
