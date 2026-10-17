// What the mode display shows, and where it goes. Pure: no DOM.

import { Mode, MODE_TABLE, MODES } from "../domain/mode.js";
import { PlaybackStatus } from "../domain/commentary-state.js";

/**
 * @typedef {{ available: boolean, title: string, status: string, playingTitle: string, index: number, count: number }} CommentaryView
 * @typedef {{ id: string, active: boolean, on: boolean, playing: boolean, label: string }} Chip
 */

/** @param {{ mode: string, floor: string | null, commentary: CommentaryView }} s floor: the current floor's label, "" if unknown, null if no picker
 * @returns {Chip[]} */
export function hudChips({ mode, floor, commentary: c }) {
  /** @type {Record<string, Omit<Chip, "id" | "active">>} */
  const chips = {
    [Mode.LEVELS]: {
      on: floor !== null,
      playing: false,
      label: floor !== null ? `Floor ${floor || "?"}` : "No floors here",
    },
    [Mode.COMMENTARY]: {
      on: c.available || c.status !== PlaybackStatus.STOPPED,
      playing: c.status === PlaybackStatus.PLAYING,
      label:
        c.status === PlaybackStatus.PLAYING
          ? c.playingTitle
          : c.status === PlaybackStatus.PAUSED
            ? `⏸ ${c.playingTitle}`
            : c.available
              ? c.count > 1
                ? `${c.title} (${c.index + 1}/${c.count})`
                : c.title
              : "Nothing nearby",
    },
    [Mode.BROWSER]: { on: true, playing: false, label: MODE_TABLE[Mode.BROWSER].name },
    [Mode.MINIMAP]: { on: true, playing: false, label: MODE_TABLE[Mode.MINIMAP].name },
  };
  return MODES.map((id) => ({ id, active: id === mode, ...chips[id] }));
}

/**
 * The spot closest to the lower right corner that is clear of every obstacle:
 * try each combination of "flush with the edge" and "just left of / above an
 * obstacle". Returns distances from the right and bottom edges.
 * @param {{ width: number, height: number }} viewport
 * @param {{ width: number, height: number }} box
 * @param {{ left: number, top: number, right: number, bottom: number }[]} obstacles
 * @param {number} margin
 */
export function placeBox(viewport, box, obstacles, margin) {
  const { width: W, height: H } = viewport;
  const { width: w, height: h } = box;
  const rights = [margin, ...obstacles.map((r) => W - r.left + margin / 2)];
  const bottoms = [margin, ...obstacles.map((r) => H - r.top + margin / 2)];
  let best = null;
  for (const right of rights) {
    for (const bottom of bottoms) {
      const l = W - right - w;
      const t = H - bottom - h;
      const rr = W - right;
      const b = H - bottom;
      if (l < W / 3 || t < H / 2) continue;
      if (obstacles.some((o) => o.left < rr + 2 && o.right > l - 2 && o.top < b + 2 && o.bottom > t - 2)) continue;
      if (!best || right + bottom < best.right + best.bottom) best = { right, bottom };
    }
  }
  return best || { right: margin, bottom: margin };
}
