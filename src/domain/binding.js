// What a gamepad input assigned to an action looks like:
//   3          button 3
//   "a1+"      axis 1 above +AXIS_THRESHOLD ("a1-": below -AXIS_THRESHOLD)
//   "a9=-1.00" axis 9 at -1.00: a hat switch position. Some systems report a
//              single Joy-Con's stick as one axis resting outside -1..1.

import { AXIS_RELEASE, AXIS_THRESHOLD, HAT_TOLERANCE } from "../shared/config.js";

/** @typedef {{ buttons: ReadonlyArray<{ pressed: boolean }>, axes?: ReadonlyArray<number>, index?: number }} PadState */

const AXIS_RE = /^a(\d+)(?:([+-])|=(-?\d+(?:\.\d+)?))$/;

/** @param {import("./actions.js").BindingValue} binding @param {PadState} pad */
export function isBindingActive(binding, pad) {
  if (typeof binding === "number") return !!pad.buttons[binding]?.pressed;
  const m = typeof binding === "string" ? binding.match(AXIS_RE) : null;
  const v = m && pad.axes?.[+m[1]];
  if (typeof v !== "number") return false;
  if (m[2]) return (m[2] === "+" ? v : -v) > AXIS_THRESHOLD;
  return Math.abs(v - +m[3]) < HAT_TOLERANCE;
}

/** How the key mapping window shows a binding. @param {import("./actions.js").BindingValue} binding */
export function bindingLabel(binding) {
  if (binding == null) return "—";
  if (typeof binding === "number") return `Button ${binding}`;
  const [, axis, dir, value] = binding.match(AXIS_RE) || [];
  if (dir) return `Axis ${axis} ${dir}`;
  if (value) return `Axis ${axis} = ${value}`;
  return "?";
}

/**
 * Turns what is pressed on gamepads into bindings, for assigning them. Axes
 * count from where they rested when detection started (triggers on some pads
 * rest at -1); axes resting outside -1..1 are hat switches.
 */
export class InputDetector {
  constructor() {
    /** @type {Map<number, number[]>} gamepad index -> its axes at rest */
    this.rest = new Map();
  }

  /** Forget the rest positions; the next look at each pad takes them anew. */
  reset() {
    this.rest.clear();
  }

  /** Buttons first, then axes moved from rest.
   * @param {PadState} pad @param {number} [threshold] @returns {(number | string)[]} */
  pressed(pad, threshold = AXIS_THRESHOLD) {
    const axes = pad.axes || [];
    const key = pad.index ?? 0;
    if (!this.rest.has(key)) this.rest.set(key, [...axes]);
    const rest = this.rest.get(key);
    /** @type {(number | string)[]} */
    const out = pad.buttons.flatMap((b, i) => (b.pressed ? [i] : []));
    axes.forEach((v, i) => {
      const r = rest[i] ?? 0;
      const d = v - r;
      if (Math.abs(r) > 1) {
        if (Math.abs(d) > HAT_TOLERANCE) out.push(`a${i}=${v.toFixed(2)}`);
      } else if (Math.abs(d) > threshold) {
        out.push(`a${i}${d > 0 ? "+" : "-"}`);
      }
    });
    return out;
  }

  /** Whether anything is still held, with the lower release threshold. @param {PadState} pad */
  held(pad) {
    return this.pressed(pad, AXIS_RELEASE).length > 0;
  }
}
