// Switching between the floors of a floor picker, which lists the top floor first.

export const LevelStep = Object.freeze({ UP: -1, DOWN: 1 });

/**
 * Index of the floor to switch to. Past the top, or from an unknown floor
 * (current < 0), going up starts at the bottom; going down past the bottom
 * starts at the top.
 * @param {number} count @param {number} current @param {number} step
 */
export function levelTarget(count, current, step) {
  if (current < 0) return step < 0 ? count - 1 : 0;
  return (((current + step) % count) + count) % count;
}

/** A floor label like "B1", "1", "2F", "EG". "3D" is the map's 3D button. */
export const isLevelLabel = (/** @type {string} */ label) =>
  /^(?:-?\d{1,3}[A-Z]{0,2}|[A-Z]{1,2}-?\d{0,2}[A-Z]?)$/i.test(label) && !/^3D$/i.test(label);
