import { KeyValueStore } from "../ports/index.js";

/** sessionStorage, which may be unavailable (privacy settings): then nothing is remembered.
 * @implements {KeyValueStore} */
export class SessionStore extends KeyValueStore {
  /** @param {() => Storage} storage a getter, as even reading `sessionStorage` can throw */
  constructor(storage) {
    super();
    this.storage = storage;
  }
  get(/** @type {string} */ key) {
    try {
      return this.storage().getItem(key);
    } catch {
      return null;
    }
  }
  set(/** @type {string} */ key, /** @type {string} */ value) {
    try {
      this.storage().setItem(key, value);
    } catch {
      /* not remembered */
    }
  }
  remove(/** @type {string} */ key) {
    try {
      this.storage().removeItem(key);
    } catch {
      /* not remembered */
    }
  }
}

/** A KeyValueStore in memory, for tests. @implements {KeyValueStore} */
export class MemoryStore extends KeyValueStore {
  /** @param {Record<string, string>} [initial] */
  constructor(initial = {}) {
    super();
    this.data = new Map(Object.entries(initial));
  }
  get(/** @type {string} */ key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  set(/** @type {string} */ key, /** @type {string} */ value) {
    this.data.set(key, value);
  }
  remove(/** @type {string} */ key) {
    this.data.delete(key);
  }
}
