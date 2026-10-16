// The modes the mode button cycles through; the mode action button does what
// the current one says.

export const Mode = Object.freeze({ LEVELS: "levels", COMMENTARY: "commentary" });
/** @type {readonly string[]} */
export const MODES = Object.freeze([Mode.LEVELS, Mode.COMMENTARY]);

/** @param {string} mode */
export const nextMode = (mode) => MODES[(MODES.indexOf(mode) + 1) % MODES.length];
/** @param {unknown} m @returns {m is string} */
export const isMode = (m) => typeof m === "string" && MODES.includes(m);
