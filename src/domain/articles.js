// Choosing among the Wikipedia articles near a place.

import { ARTICLE_LEAD, WIKI_DISTANCE_BIAS, WIKI_RADIUS } from "../shared/config.js";

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

const FOREIGN = String.raw`(?![\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}])\p{L}\p{M}*`;
const FOREIGN_LETTER = new RegExp(FOREIGN, "gu");
const FOREIGN_RUN = new RegExp(String.raw`${FOREIGN}(?:[\s\-'’·・]*${FOREIGN})*`, "gu");
const LATIN_LETTER = /\p{Script=Latin}/gu;
const EMPTY_LABEL = /[\p{L} .-]*:\s*(?=[;,)]|$)/gu;

/** Tidies what removing a name in another script leaves behind. @param {string} s */
function tidyAfterRemoval(s) {
  let out = s;
  for (let before = ""; before !== out;) {
    before = out;
    out = out
      .replace(EMPTY_LABEL, "")
      .replace(/\(\s*[;,]\s*/g, "(")
      .replace(/\s*[;,]\s*\)/g, ")")
      .replace(/([;,])\s*[;,]/g, "$1")
      .replace(/\s*\(\s*\)/g, "");
  }
  return out.replace(/ {2,}/g, " ").replace(/ ([,;.)])/g, "$1");
}

/**
 * For the speech engine: articles often repeat the place's name in its own
 * script right after the title ("Beijing (Chinese: 北京; pinyin: Běijīng) is…"),
 * which it would stumble over. Takes out letters of non-Latin scripts from the
 * start of the article only. An article mostly in such a script is left alone.
 * @param {string} text
 */
export function withoutForeignLead(text) {
  const foreign = text.match(FOREIGN_LETTER)?.length ?? 0;
  if (!foreign || foreign > (text.match(LATIN_LETTER)?.length ?? 0)) return text;
  const space = text.indexOf(" ", ARTICLE_LEAD);
  const end = space < 0 ? text.length : space;
  const lead = text.slice(0, end);
  const stripped = lead.replace(FOREIGN_RUN, "");
  return stripped === lead ? text : tidyAfterRemoval(stripped).trimStart() + text.slice(end);
}
