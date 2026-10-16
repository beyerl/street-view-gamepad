// Choosing among the Wikipedia articles near a place.

import { WIKI_DISTANCE_BIAS, WIKI_RADIUS } from "../shared/config.js";

/**
 * @typedef {{ pageid: number, length: number, coordinates?: { dist: number }[] }} GeoPage
 * @typedef {{ id: string, lang: string, title: string, text: string, audio: string | null }} Article
 */

/** The nearest article isn't always the interesting one (next to the
 * Brandenburg Gate sits a club's office), so weigh length against distance.
 * @param {GeoPage[]} pages @returns {number[]} page ids, most interesting first */
export function rankPages(pages) {
  const score = (/** @type {GeoPage} */ p) =>
    p.length / ((p.coordinates?.[0]?.dist ?? WIKI_RADIUS) + WIKI_DISTANCE_BIAS);
  return [...pages].sort((a, b) => score(b) - score(a)).map((p) => p.pageid);
}

/** The articles near a place, one of them selected. */
export class ArticlePlaylist {
  /** @param {string} lang @param {number[]} pageids */
  constructor(lang, pageids) {
    this.lang = lang;
    this.pageids = pageids;
    this.index = 0;
  }

  get count() {
    return this.pageids.length;
  }

  get pageid() {
    return this.pageids[this.index];
  }

  /** Index `step` away, wrapping around. @param {number} step */
  indexAfter(step) {
    const n = this.count;
    return (((this.index + step) % n) + n) % n;
  }
}

/** Does a Commons category mark a file as a Spoken Wikipedia recording (not a pronunciation clip)?
 * @param {string} category */
export const isSpokenCategory = (category) => /spoken/i.test(category) && !/pronunciation/i.test(category);

/** Audio files among a page's images, as "File:" titles. @param {{ title: string }[]} images @param {number} max */
export function audioFiles(images, max) {
  return images
    .map((i) => i.title.replace(/^[^:]+:/, "File:")) // "Datei:x.ogg" -> "File:x.ogg"
    .filter((t) => /\.(ogg|oga|opus|mp3|flac|wav)$/i.test(t))
    .slice(0, max);
}
