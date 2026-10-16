// The key mapping window's logic: walks through all actions and lets the
// player assign a gamepad button or axis to each, like the Recalbox /
// EmulationStation input configuration.

import { ACTIONS, defaultButtonMap } from "../domain/actions.js";
import { InputDetector } from "../domain/binding.js";

export const IDLE = -1;

export class KeyMappingSession {
  /** @param {{ save: (map: Record<string, any>) => Promise<void>, onChange: () => void }} deps */
  constructor({ save, onChange }) {
    this.save = save;
    this.onChange = onChange;
    this.map = defaultButtonMap();
    this.step = IDLE; // index into ACTIONS being configured
    this.single = false; // configuring just one action
    this.armed = false; // false until everything was released after the last assignment
    this.detector = new InputDetector();
  }

  get actions() {
    return ACTIONS;
  }

  get configuring() {
    return this.step !== IDLE;
  }

  /** @param {Record<string, any>} stored */
  load(stored) {
    this.map = { ...defaultButtonMap(), ...stored };
    this.onChange();
  }

  /** @param {number} i @param {boolean} one */
  begin(i, one) {
    this.detector.reset(); // sticks are at rest while the player clicks
    this.step = i;
    this.single = one;
    this.armed = false;
    this.onChange();
  }

  end() {
    this.step = IDLE;
    this.onChange();
  }

  advance() {
    this.armed = false;
    if (this.single || this.step + 1 >= ACTIONS.length) this.end();
    else {
      this.step++;
      this.onChange();
    }
  }

  /** @param {number | string} binding */
  async assign(binding) {
    const id = ACTIONS[this.step].id;
    // A button or axis direction belongs to one action: unassign it elsewhere.
    for (const k of Object.keys(this.map)) if (this.map[k] === binding) this.map[k] = null;
    this.map[id] = binding;
    this.advance();
    await this.save(this.map);
  }

  async reset() {
    this.map = defaultButtonMap();
    this.end();
    await this.save(this.map);
  }

  /** Polled with the connected gamepads. @param {import("../domain/binding.js").PadState[]} pads */
  poll(pads) {
    if (!this.configuring) return;
    const down = pads.flatMap((p) => this.detector.pressed(p));
    // Wait for release so one press isn't taken twice.
    if (!pads.some((p) => this.detector.held(p))) this.armed = true;
    else if (this.armed && down.length) this.assign(down[0]);
  }
}
