// What the mode display shows, and where it goes. Pure: no DOM.

import { MODE_BUTTONS, presetOf } from "../domain/actions.js";
import { buttonName } from "../domain/binding.js";
import { COMMAND_LABELS, Mode, MODE_TABLE, MODES, modeCommand } from "../domain/mode.js";
import { PlaybackStatus } from "../domain/commentary-state.js";

/**
 * @typedef {{ available: boolean, title: string, status: string, playingTitle: string, loading?: boolean, index: number, count: number }} CommentaryView
 * @typedef {{ id: string, active: boolean, on: boolean, playing: boolean, loading: boolean, label: string }} Chip
 * @typedef {{ button: string, label: string }} SummaryLine
 */

/** @param {{ mode: string, floor: string | null, commentary: CommentaryView }} s floor: the current floor's label, "" if unknown, null if no picker
 * @returns {Chip[]} */
export function hudChips({ mode, floor, commentary: c }) {
  /** @type {Record<string, Omit<Chip, "id" | "active">>} */
  const chips = {
    [Mode.LEVELS]: {
      on: floor !== null,
      playing: false,
      loading: false,
      label: floor !== null ? `Floor ${floor || "?"}` : "No floors here",
    },
    [Mode.COMMENTARY]: {
      on: c.available || c.status !== PlaybackStatus.STOPPED,
      playing: c.status === PlaybackStatus.PLAYING && !c.loading,
      loading: c.status === PlaybackStatus.PLAYING && !!c.loading,
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
    [Mode.BROWSER]: { on: true, playing: false, loading: false, label: MODE_TABLE[Mode.BROWSER].name },
    [Mode.MINIMAP]: { on: true, playing: false, loading: false, label: MODE_TABLE[Mode.MINIMAP].name },
  };
  return MODES.map((id) => ({ id, active: id === mode, ...chips[id] }));
}

/** What the mode buttons do in `mode`, each by the name of its button on the pad.
 * @param {string} mode @param {Record<string, import("../domain/actions.js").BindingValue>} buttonMap
 * @returns {SummaryLine[]} */
export function hudSummary(mode, buttonMap) {
  const preset = presetOf(buttonMap);
  return MODE_BUTTONS.flatMap((action, i) => {
    const command = modeCommand(mode, i);
    const binding = buttonMap[action] ?? null;
    if (!command || binding === null) return [];
    return [{ button: buttonName(binding, preset), label: COMMAND_LABELS[command] }];
  });
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
