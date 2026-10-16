// radio aporee ::: maps (https://aporee.org/maps/), an open global sound map
// of field recordings. Its JSON API is the one its map page uses; it only
// answers requests carrying the map page as Referer, which fetch() can't set,
// so a declarativeNetRequest session rule adds it to our own requests.

import { LOCATIONS_MAX_AGE } from "../shared/config.js";
import { StorageKey } from "../shared/storage-keys.js";
import { RecordingRepository } from "../ports/index.js";

export const APOREE_API = "https://aporee.org/api/maps/";
const RULE_ID = 1;
const COORD_DECIMALS = 5; // ~1 m, keeps the cached list small

/** The session rule that makes aporee answer. @param {string} extensionId */
export const aporeeRule = (extensionId) => ({
  id: RULE_ID,
  priority: 1,
  action: {
    type: "modifyHeaders",
    requestHeaders: [
      { header: "Referer", operation: "set", value: "https://aporee.org/maps/" },
      { header: "X-Requested-With", operation: "set", value: "XMLHttpRequest" },
    ],
  },
  condition: {
    urlFilter: `|${APOREE_API}`,
    initiatorDomains: [extensionId],
    resourceTypes: ["xmlhttprequest", "other"],
  },
});

/** @implements {RecordingRepository} */
export class AporeeRecordingRepository extends RecordingRepository {
  /**
   * @param {{ fetch: typeof globalThis.fetch, cache: chrome.storage.StorageArea, ready: Promise<unknown>, now: () => number }} deps
   *   cache: where the ~1.8 MB of locations are kept for a week; ready: the session rule is in place
   */
  constructor({ fetch, cache, ready, now }) {
    super();
    this.fetch = fetch;
    this.cache = cache;
    this.ready = ready;
    this.now = now;
    /** @type {import("../domain/recordings.js").RecordingLocation[] | null} */
    this.memo = null;
  }

  /** @param {string} method @param {Record<string, any>} [params] */
  async api(method, params = {}) {
    await this.ready;
    const res = await this.fetch(`${APOREE_API}${method}?${new URLSearchParams(params)}`);
    if (!res.ok) throw new Error(`aporee ${method}: HTTP ${res.status}`);
    return res.json();
  }

  /** All ~70k recording locations as [locid, lat, lng]. */
  async locations() {
    if (this.memo) return this.memo;
    /** @type {any} */
    const { [StorageKey.APOREE_LOCATIONS]: cached } = await this.cache.get(StorageKey.APOREE_LOCATIONS);
    if (cached && this.now() - cached.fetchedAt < LOCATIONS_MAX_AGE) return (this.memo = cached.data);
    const all = await this.api("getAllLocations");
    /** @type {import("../domain/recordings.js").RecordingLocation[]} */
    const data = all.map((/** @type {any} */ l) => [
      +l.locid,
      +(+l.lat).toFixed(COORD_DECIMALS),
      +(+l.lng).toFixed(COORD_DECIMALS),
    ]);
    await this.cache.set({ [StorageKey.APOREE_LOCATIONS]: { fetchedAt: this.now(), data } });
    return (this.memo = data);
  }

  async playlist(/** @type {number} */ locid) {
    const sounds = await this.api("getPlaylist", { "locids[]": locid });
    return Array.isArray(sounds) ? sounds : [];
  }
}
