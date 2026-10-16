// Small adapters over browser globals.

import { InputSource, PageNavigator } from "../ports/index.js";

/** @implements {PageNavigator} */
export class LocationNavigator extends PageNavigator {
  /** @param {Location} location @param {History} history */
  constructor(location, history) {
    super();
    this.location = location;
    this.history = history;
  }
  get href() {
    return this.location.href;
  }
  get origin() {
    return this.location.origin;
  }
  get search() {
    return this.location.search;
  }
  assign(/** @type {string} */ url) {
    this.location.assign(url);
  }
  back() {
    this.history.back();
  }
  forward() {
    this.history.forward();
  }
}

/** @implements {InputSource} */
export class GamepadInput extends InputSource {
  /** @param {Navigator} navigator */
  constructor(navigator) {
    super();
    this.navigator = navigator;
  }
  pads() {
    return [...this.navigator.getGamepads()].filter((gp) => gp && gp.connected);
  }
}
