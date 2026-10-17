// The background's side of the audio commentary: which articles are near
// each tab, and playing one (a Spoken Wikipedia recording, or its
// introduction read aloud) in the offscreen document. It is the context of
// the playback state machine (domain/commentary-state.js).

import { Paused, Playing, PlaybackStatus, Stopped } from "../domain/commentary-state.js";
import { ERROR_NOTICE } from "../shared/config.js";
import { Msg, OffscreenMsg } from "../shared/messages.js";

/** @typedef {import("../domain/articles.js").Article} Article */
/** @typedef {import("../domain/commentary-state.js").PlaybackContext} PlaybackContext */

/** @implements {PlaybackContext} */
export class CommentaryService {
  /**
   * @param {{ articles: import("../ports/index.js").ArticleRepository, audio: import("../ports/index.js").OffscreenAudio,
   *           sendToTab: (tabId: number, msg: object) => Promise<unknown>, log: (...a: any[]) => void, warn: (...a: any[]) => void }} deps
   */
  constructor({ articles, audio, sendToTab, log, warn }) {
    this.articles = articles;
    this.audio = audio;
    this.sendToTab = sendToTab;
    this.log = log;
    this.warn = warn;
    // In memory: if the worker restarts, a paused commentary is forgotten.
    /** @type {Map<number, Article | null>} the article selected near each tab */
    this.nearby = new Map();
    /** @type {Map<number, import("../domain/articles.js").ArticlePlaylist | null>} */
    this.playlists = new Map();
    /** @type {Map<number, number>} to drop stale lookups */
    this.lookupSeq = new Map();
    /** @type {import("../domain/commentary-state.js").Stopped | Playing | Paused} */
    this.state = new Stopped();
    /** @type {number | null} tab that sees download progress and errors */
    this.noticeTab = null;
    /** Asked to play, but no sound yet. */
    this.loading = false;
  }

  nearbyFor(/** @type {number} */ tabId) {
    return this.nearby.get(tabId) || null;
  }

  /** @param {number} tabId */
  bumpSeq(tabId) {
    const seq = (this.lookupSeq.get(tabId) || 0) + 1;
    this.lookupSeq.set(tabId, seq);
    return seq;
  }

  /** The articles near a tab's new position. @param {number} tabId @param {import("../domain/geo.js").GeoPoint} point */
  async lookup(tabId, point) {
    const seq = this.bumpSeq(tabId);
    let playlist = null;
    let article = null;
    try {
      playlist = await this.articles.nearby(point);
      if (playlist) article = await this.articles.details(playlist.lang, playlist.pageid);
    } catch (err) {
      this.warn("commentary:", err);
    }
    if (this.lookupSeq.get(tabId) !== seq) return;
    this.playlists.set(tabId, article && playlist);
    this.nearby.set(tabId, article);
    this.push(tabId);
    this.preload(tabId, article);
  }

  /** Get the voice ready (downloaded on first use) before it is needed. @param {number} tabId @param {Article | null} article */
  preload(tabId, article) {
    if (!article || article.audio) return;
    this.noticeTab = tabId;
    this.audio.send({ type: OffscreenMsg.COMMENTARY_PRELOAD, lang: article.lang }).catch(() => {});
  }

  /** Next (1) or previous (-1) of the articles nearby, wrapping around. A
   * playing commentary switches to the new article. @param {number} tabId @param {number} step */
  async next(tabId, step) {
    const list = this.playlists.get(tabId);
    if (!list || list.count < 2) return this.push(tabId);
    const seq = this.bumpSeq(tabId);
    const index = list.indexAfter(step);
    let article;
    try {
      article = await this.articles.details(list.lang, list.pageids[index]);
    } catch (err) {
      this.warn("commentary:", err);
      return;
    }
    if (this.lookupSeq.get(tabId) !== seq) return;
    list.index = index;
    this.nearby.set(tabId, article);
    if (this.state instanceof Playing && this.state.belongsTo(tabId)) await this.start(tabId, article);
    this.push(tabId);
    this.preload(tabId, article);
  }

  /** The commentary button. @param {number} tabId */
  async toggle(tabId) {
    await this.state.toggle(this, tabId);
    this.push(tabId);
  }

  /** @param {number} [tabId] */
  async pause(tabId) {
    await this.state.pause(this, tabId);
  }

  // --- PlaybackContext ---------------------------------------------------------

  async start(/** @type {number} */ tabId, /** @type {Article} */ article) {
    await this.stop();
    this.state = new Playing(tabId, article);
    this.noticeTab = tabId;
    this.loading = true;
    this.log(`commentary: ${article.title} (${article.audio ? "recording" : "text-to-speech"})`);
    if (article.audio) await this.audio.send({ type: OffscreenMsg.COMMENTARY_PLAY, url: article.audio });
    else
      await this.audio.send({
        type: OffscreenMsg.COMMENTARY_SPEAK,
        text: article.text || article.title,
        lang: article.lang,
      });
  }

  async pauseCurrent() {
    const { tabId, article } = this.state;
    this.state = new Paused(tabId, article);
    this.loading = false;
    await this.audio.send({ type: OffscreenMsg.COMMENTARY_PAUSE });
    this.push(tabId);
  }

  async resume() {
    const { tabId, article } = this.state;
    this.state = new Playing(tabId, article);
    const res = await this.audio.send({ type: OffscreenMsg.COMMENTARY_RESUME });
    if (!res?.ok) await this.start(tabId, article); // the offscreen document was recreated
  }

  // ------------------------------------------------------------------------------

  async stop() {
    if (this.state instanceof Stopped) return;
    const { tabId } = this.state;
    this.state = new Stopped();
    this.loading = false;
    if (await this.audio.isOpen()) await this.audio.send({ type: OffscreenMsg.COMMENTARY_STOP });
    this.push(tabId);
  }

  /** The offscreen document finished playing, or failed. @param {string} [error] */
  ended(error) {
    if (error) this.notice(error, ERROR_NOTICE);
    if (this.state instanceof Stopped) return;
    const { tabId } = this.state;
    this.state = new Stopped();
    this.loading = false;
    this.push(tabId);
  }

  /** The offscreen document started or stopped waiting for sound. @param {boolean} loading */
  setLoading(loading) {
    this.loading = !!loading;
    if (this.state instanceof Playing) this.push(this.state.tabId);
  }

  /** A message box on the page: download progress, or why a commentary can't
   * play. "" hides it; ms = 0 keeps it until replaced. @param {string} message @param {number} [ms] */
  notice(message, ms = 0) {
    if (message) this.log("commentary:", message);
    if (this.noticeTab === null) return;
    this.sendToTab(this.noticeTab, { type: Msg.COMMENTARY_NOTICE, message, ms }).catch(() => {});
  }

  /** @param {number} tabId */
  forgetTab(tabId) {
    this.nearby.delete(tabId);
    this.playlists.delete(tabId);
    this.lookupSeq.delete(tabId);
    if (this.noticeTab === tabId) this.noticeTab = null;
    if (this.state.belongsTo(tabId)) this.stop();
  }

  /** Tell a tab what is nearby and what plays. @param {number} tabId */
  push(tabId) {
    const a = this.nearby.get(tabId);
    const list = this.playlists.get(tabId);
    const mine = this.state.belongsTo(tabId);
    this.sendToTab(tabId, {
      type: Msg.COMMENTARY,
      state: {
        available: !!a,
        title: a?.title || "",
        status: mine ? this.state.status : PlaybackStatus.STOPPED,
        playingTitle: (mine && this.state.article?.title) || "",
        loading: mine && this.state instanceof Playing && this.loading,
        index: list?.index || 0,
        count: list?.count || 0,
      },
    }).catch(() => {}); // tab gone or reloading
  }
}
