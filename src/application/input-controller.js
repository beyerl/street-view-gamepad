// Turns the gamepads' state into actions, every tick: held actions press on
// and repeat, look actions drag the view, press actions run once per press
// (Command pattern: `commands` maps action ids and mode commands to what they
// do). The mode buttons run what the current mode assigns to them.

import { Action, ActionKind, actionsOfKind, MODE_BUTTONS } from "../domain/actions.js";
import { isBindingActive } from "../domain/binding.js";
import { modeCommand, REPEATING } from "../domain/mode.js";
import { KEY_REPEAT_DELAY, KEY_REPEAT_INTERVAL, MAX_FRAME } from "../shared/config.js";
import { WalkEdge } from "./jump-service.js";

const HELD = actionsOfKind(ActionKind.HELD);
const PRESS = actionsOfKind(ActionKind.PRESS);

export class InputController {
  /**
   * @param {{ input: import("../ports/index.js").InputSource, settings: { buttonMap: Record<string, any> },
   *           isHidden: () => boolean, isStreetView: () => boolean,
   *           streetView: import("../ports/index.js").ViewControls, map: import("../ports/index.js").ViewControls,
   *           jump: import("./jump-service.js").JumpService, commands: Record<string, () => void>,
   *           mode: () => string, now: () => number, log: (level: string, ...a: any[]) => void }} deps
   */
  constructor({ input, settings, isHidden, isStreetView, streetView, map, jump, commands, mode, now, log }) {
    this.input = input;
    this.settings = settings;
    this.isHidden = isHidden;
    this.isStreetView = isStreetView;
    this.streetView = streetView;
    this.map = map;
    this.jump = jump;
    this.commands = commands;
    this.mode = mode;
    this.now = now;
    this.log = log;
    /** @type {Map<string, { action: { down(repeat: boolean): void, up(): void }, nextAt: number }>} */
    this.held = new Map();
    /** @type {Set<string>} press actions whose binding was active last tick */
    this.wasPressed = new Set();
    this.walkWas = { fwd: false, back: false };
    this.lastFrame = now();
    this.lastStreetView = /** @type {boolean | null} */ (null);
    this.lastPressedLog = "";
  }

  /** @param {import("../domain/binding.js").PadState[]} pads @param {string} action */
  pressed(pads, action) {
    const b = this.settings.buttonMap?.[action];
    return b != null && pads.some((pad) => isBindingActive(b, pad));
  }

  releaseAll() {
    for (const [, s] of this.held) s.action.up();
    this.held.clear();
    this.streetView.look(0, 0, 0);
    this.map.look(0, 0, 0);
    this.wasPressed.clear();
    this.walkWas = { fwd: false, back: false };
  }

  /** @param {string} name @param {ReturnType<import("../ports/index.js").ViewControls["held"]>} action @param {boolean} pressed @param {number} now */
  updateHeld(name, action, pressed, now) {
    const state = this.held.get(name);
    // Marked first, so an action that throws doesn't run again every tick.
    if (pressed && !state && action) {
      this.held.set(name, { action, nextAt: now + KEY_REPEAT_DELAY });
      action.down(false);
    } else if (pressed && state && now >= state.nextAt) {
      state.nextAt = now + KEY_REPEAT_INTERVAL;
      state.action.down(true);
    } else if (!pressed && state) {
      state.action.up();
      this.held.delete(name);
    }
  }

  /** What mode button `index` does in the current mode, as a held action, or
   * null if nothing. Only some commands repeat while held. @param {number} index */
  modeButton(index) {
    const cmd = modeCommand(this.mode(), index);
    const run = cmd && this.commands[cmd];
    if (!run) return null;
    return { down: (/** @type {boolean} */ repeat) => (!repeat || REPEATING.has(cmd)) && run(), up: () => {} };
  }

  /** @param {import("../domain/binding.js").PadState[]} pads */
  logPads(pads) {
    const desc = pads
      .map((gp) => `pad ${gp.index}: [${gp.buttons.flatMap((b, i) => (b.pressed ? [i] : [])).join(",")}]`)
      .join("  ");
    if (desc === this.lastPressedLog) return;
    this.lastPressedLog = desc;
    this.log("debug", desc);
  }

  tick() {
    const now = this.now();
    const dt = Math.min(now - this.lastFrame, MAX_FRAME);
    this.lastFrame = now;
    const pads = this.input.pads();
    this.logPads(pads);
    if (!pads.length || this.isHidden()) {
      this.releaseAll();
      return;
    }
    const pressed = (/** @type {string} */ a) => this.pressed(pads, a);

    const streetView = this.isStreetView();
    if (streetView !== this.lastStreetView) {
      this.lastStreetView = streetView;
      this.log("debug", streetView ? "Street View" : "map");
    }
    if (!streetView) this.jump.cancel();
    const controls = streetView ? this.streetView : this.map;

    for (const name of HELD) this.updateHeld(name, controls.held(name), pressed(name), now);
    // Looked up on press only: the command stays the same while held.
    MODE_BUTTONS.forEach((name, i) => {
      const down = pressed(name);
      this.updateHeld(name, down && !this.held.has(name) ? this.modeButton(i) : null, down, now);
    });

    // On the map, forward / back pan like look up / down.
    const dir = (/** @type {string} */ look, /** @type {string} */ walk) =>
      pressed(look) || (controls.walkPans && pressed(walk));
    controls.look(
      (pressed(Action.LOOK_RIGHT) ? 1 : 0) - (pressed(Action.LOOK_LEFT) ? 1 : 0),
      (dir(Action.LOOK_DOWN, Action.BACK) ? 1 : 0) - (dir(Action.LOOK_UP, Action.FORWARD) ? 1 : 0),
      dt,
    );

    const walk = { fwd: pressed(Action.FORWARD), back: pressed(Action.BACK) };
    if (streetView) {
      const edge =
        walk.fwd && !this.walkWas.fwd ? WalkEdge.FORWARD : walk.back && !this.walkWas.back ? WalkEdge.BACK : null;
      this.jump.onWalk(edge, this.jump.checkingBack ? walk.back : walk.fwd, now);
    }
    this.walkWas = walk;

    for (const name of PRESS) {
      const down = pressed(name);
      if (!down) this.wasPressed.delete(name);
      else if (!this.wasPressed.has(name)) {
        // Marked first, so a command that throws doesn't run again every tick.
        this.wasPressed.add(name);
        this.commands[name]?.();
      }
    }
  }
}
