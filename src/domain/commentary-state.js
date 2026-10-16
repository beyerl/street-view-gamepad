// Commentary playback as a state machine (State pattern). Each state decides
// what the commentary button and a pause request do; the context (the
// background's CommentaryService) carries them out.

/**
 * @typedef {import("./articles.js").Article} Article
 * @typedef {object} PlaybackContext
 * @property {(tabId: number) => Article | null} nearbyFor the article selected near that tab's position
 * @property {(tabId: number, article: Article) => Promise<void>} start
 * @property {() => Promise<void>} pauseCurrent
 * @property {() => Promise<void>} resume
 */

export const PlaybackStatus = Object.freeze({ STOPPED: "stopped", PLAYING: "playing", PAUSED: "paused" });

class PlaybackState {
  /** @param {number | null} tabId @param {Article | null} article */
  constructor(tabId, article) {
    this.tabId = tabId;
    this.article = article;
  }
  /** @returns {string} */
  get status() {
    throw new Error("abstract");
  }
  /** The commentary button in `tabId`. @param {PlaybackContext} _ctx @param {number} _tabId @returns {Promise<void>} */
  async toggle(_ctx, _tabId) {}
  /** Pause if playing (for `tabId`, or for any tab). @param {PlaybackContext} _ctx @param {number} [_tabId] @returns {Promise<void>} */
  async pause(_ctx, _tabId) {}
  /** Whether `tabId` plays or paused this commentary. @param {number} tabId */
  belongsTo(tabId) {
    return this.tabId === tabId;
  }
}

export class Stopped extends PlaybackState {
  constructor() {
    super(null, null);
  }
  get status() {
    return PlaybackStatus.STOPPED;
  }
  /** Start the nearby article, if there is one. */
  async toggle(/** @type {PlaybackContext} */ ctx, /** @type {number} */ tabId) {
    const a = ctx.nearbyFor(tabId);
    if (a) await ctx.start(tabId, a);
  }
}

export class Playing extends PlaybackState {
  get status() {
    return PlaybackStatus.PLAYING;
  }
  /** Pause, whichever tab asks. */
  async toggle(/** @type {PlaybackContext} */ ctx) {
    await ctx.pauseCurrent();
  }
  async pause(/** @type {PlaybackContext} */ ctx, /** @type {number | undefined} */ tabId) {
    if (tabId === undefined || tabId === this.tabId) await ctx.pauseCurrent();
  }
}

export class Paused extends PlaybackState {
  get status() {
    return PlaybackStatus.PAUSED;
  }
  /** Resume if it is still the article nearby (or nothing else is); otherwise start the one nearby. */
  async toggle(/** @type {PlaybackContext} */ ctx, /** @type {number} */ tabId) {
    const a = ctx.nearbyFor(tabId);
    if (tabId === this.tabId && (!a || a.id === this.article?.id)) await ctx.resume();
    else if (a) await ctx.start(tabId, a);
  }
}
