// Articles near a place from the Wikipedia API: English, or else the browser's
// language. An article's Spoken Wikipedia recording, if it has one, is an
// audio file it embeds that Commons files as spoken.

import { ArticlePlaylist, audioFiles, isSpokenCategory, rankPages } from "../domain/articles.js";
import { COMMONS_MAX_FILES, WIKI_LIMIT, WIKI_RADIUS } from "../shared/config.js";
import { ArticleRepository } from "../ports/index.js";

const COMMONS = "commons.wikimedia.org";

/** @implements {ArticleRepository} */
export class WikipediaArticleRepository extends ArticleRepository {
  /** @param {{ fetch: typeof globalThis.fetch, langs: string[], userAgent: string }} deps */
  constructor({ fetch, langs, userAgent }) {
    super();
    this.fetch = fetch;
    this.langs = langs;
    this.headers = { "Api-User-Agent": userAgent };
    /** @type {Map<string, import("../domain/articles.js").Article>} "lang:pageid" -> article */
    this.cache = new Map();
  }

  /** @param {string} host @param {Record<string, any>} params */
  async api(host, params) {
    const query = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
    const res = await this.fetch(`https://${host}/w/api.php?${query}`, { headers: this.headers });
    if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`);
    return res.json();
  }

  async nearby(/** @type {import("../domain/geo.js").GeoPoint} */ point) {
    for (const lang of this.langs) {
      const { query } = await this.api(`${lang}.wikipedia.org`, {
        action: "query",
        generator: "geosearch",
        ggscoord: `${point.lat}|${point.lng}`,
        ggsradius: WIKI_RADIUS,
        ggslimit: WIKI_LIMIT,
        prop: "info|coordinates",
        codistancefrompoint: `${point.lat}|${point.lng}`,
      });
      const ids = rankPages(query?.pages || []);
      if (ids.length) return new ArticlePlaylist(lang, ids);
    }
    return null;
  }

  async details(/** @type {string} */ lang, /** @type {number} */ pageid) {
    const id = `${lang}:${pageid}`;
    if (this.cache.has(id)) return this.cache.get(id);
    const { query } = await this.api(`${lang}.wikipedia.org`, {
      action: "query",
      pageids: pageid,
      prop: "extracts|images",
      exintro: 1,
      explaintext: 1,
      imlimit: "max",
    });
    const page = query.pages[0];
    const article = {
      id,
      lang,
      title: page.title,
      text: page.extract || "",
      audio: await this.spokenRecording(page.images || []),
    };
    this.cache.set(id, article);
    return article;
  }

  /** @param {{ title: string }[]} images @returns {Promise<string | null>} */
  async spokenRecording(images) {
    const files = audioFiles(images, COMMONS_MAX_FILES);
    if (!files.length) return null;
    const { query } = await this.api(COMMONS, {
      action: "query",
      titles: files.join("|"),
      prop: "categories|imageinfo",
      iiprop: "url",
      cllimit: "max",
    });
    const spoken = query?.pages?.find((/** @type {any} */ p) =>
      p.categories?.some((/** @type {any} */ c) => isSpokenCategory(c.title)),
    );
    return spoken?.imageinfo?.[0]?.url || null;
  }
}
