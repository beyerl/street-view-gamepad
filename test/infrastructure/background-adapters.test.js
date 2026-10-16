import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AporeeRecordingRepository,
  aporeeRule,
  APOREE_API,
} from "../../src/infrastructure/aporee-recording-repository.js";
import { ChromeOffscreenAudio } from "../../src/infrastructure/chrome-offscreen-audio.js";
import { WikipediaArticleRepository } from "../../src/infrastructure/wikipedia-article-repository.js";
import { GeoPoint } from "../../src/domain/geo.js";
import { StorageKey } from "../../src/shared/storage-keys.js";
import { errorResponse, makeChrome, router, storageArea } from "../helpers/fakes.js";

const has = (s) => (url) => url.includes(s);
const LOCATIONS = [
  { locid: "1", lat: "52.520001", lng: "13.405" },
  { locid: "2", lat: "48.8566", lng: "2.3522" },
];

test("aporee rule: sets the Referer on the extension's own API requests", () => {
  const rule = aporeeRule("ext-id");
  assert.equal(rule.condition.urlFilter, `|${APOREE_API}`);
  assert.deepEqual(rule.condition.initiatorDomains, ["ext-id"]);
  assert.equal(rule.action.requestHeaders[0].value, "https://aporee.org/maps/");
});

test("aporee: locations are fetched once, rounded, and cached for a week", async () => {
  const fetch = router([[has("getAllLocations"), LOCATIONS]]);
  const cache = storageArea();
  let now = 1000;
  const repo = new AporeeRecordingRepository({ fetch, cache, ready: Promise.resolve(), now: () => now });
  assert.deepEqual(await repo.locations(), [
    [1, 52.52, 13.405],
    [2, 48.8566, 2.3522],
  ]);
  await repo.locations();
  assert.equal(fetch.calls.length, 1);
  assert.equal(cache.data[StorageKey.APOREE_LOCATIONS].fetchedAt, 1000);

  const fresh = new AporeeRecordingRepository({ fetch, cache, ready: Promise.resolve(), now: () => now });
  await fresh.locations();
  assert.equal(fetch.calls.length, 1); // from storage
  now += 8 * 24 * 3600 * 1000;
  const stale = new AporeeRecordingRepository({ fetch, cache, ready: Promise.resolve(), now: () => now });
  await stale.locations();
  assert.equal(fetch.calls.length, 2);
});

test("aporee: playlists, waiting for the rule; errors and non-lists", async () => {
  let ruleIn = false;
  const fetch = router([[has("getPlaylist"), () => (assert.ok(ruleIn), [{ mp3: "a" }])]]);
  const repo = new AporeeRecordingRepository({
    fetch,
    cache: storageArea(),
    ready: Promise.resolve().then(() => (ruleIn = true)),
    now: Date.now,
  });
  assert.deepEqual(await repo.playlist(7), [{ mp3: "a" }]);
  assert.match(fetch.calls[0][0], /getPlaylist\?locids%5B%5D=7/);
  assert.deepEqual(
    await new AporeeRecordingRepository({
      fetch: router([[has("getPlaylist"), { error: 1 }]]),
      cache: storageArea(),
      ready: Promise.resolve(),
      now: Date.now,
    }).playlist(1),
    [],
  );
  await assert.rejects(
    new AporeeRecordingRepository({
      fetch: async () => errorResponse(503),
      cache: storageArea(),
      ready: Promise.resolve(),
      now: Date.now,
    }).playlist(1),
    /HTTP 503/,
  );
});

const wiki = (host, key) => (url) => url.startsWith(`https://${host}/`) && url.includes(key);

function wikiRoutes({ pages, extract = "Intro.", images = [], commons } = {}) {
  const routes = [
    [wiki("en.wikipedia.org", "generator=geosearch"), { query: { pages } }],
    [
      wiki("en.wikipedia.org", "prop=extracts"),
      (url) => {
        const id = new URL(url).searchParams.get("pageids");
        return { query: { pages: [{ pageid: +id, title: `Title ${id}`, extract, images }] } };
      },
    ],
  ];
  if (commons) routes.push([(u) => u.startsWith("https://commons.wikimedia.org/"), commons]);
  return routes;
}

test("wikipedia: the articles nearby, ranked, with the position and user agent", async () => {
  const fetch = router(
    wikiRoutes({
      pages: [
        { pageid: 1, length: 100, coordinates: [{ dist: 10 }] },
        { pageid: 2, length: 5000, coordinates: [{ dist: 100 }] },
      ],
    }),
  );
  const repo = new WikipediaArticleRepository({ fetch, langs: ["en"], userAgent: "SVG/1" });
  const list = await repo.nearby(new GeoPoint(52.5, 13.4));
  assert.deepEqual([list.lang, list.pageids], ["en", [2, 1]]);
  const geo = new URL(fetch.calls[0][0]);
  assert.equal(geo.searchParams.get("ggscoord"), "52.5|13.4");
  assert.equal(geo.searchParams.get("ggsradius"), "500");
  assert.equal(fetch.calls[0][1].headers["Api-User-Agent"], "SVG/1");
});

test("wikipedia: falls back to the next language; nothing anywhere is null", async () => {
  const fetch = router([
    [wiki("en.wikipedia.org", "generator=geosearch"), { query: {} }],
    [wiki("de.wikipedia.org", "generator=geosearch"), { query: { pages: [{ pageid: 3, length: 10 }] } }],
  ]);
  const repo = new WikipediaArticleRepository({ fetch, langs: ["en", "de"], userAgent: "x" });
  assert.equal((await repo.nearby(new GeoPoint(0, 0))).lang, "de");
  const none = new WikipediaArticleRepository({
    fetch: router([[() => true, { query: {} }]]),
    langs: ["en"],
    userAgent: "x",
  });
  assert.equal(await none.nearby(new GeoPoint(0, 0)), null);
  await assert.rejects(
    new WikipediaArticleRepository({ fetch: async () => errorResponse(500), langs: ["en"], userAgent: "x" }).nearby(
      new GeoPoint(0, 0),
    ),
    /HTTP 500/,
  );
});

test("wikipedia: article details are cached; without audio files no Commons lookup", async () => {
  const fetch = router(wikiRoutes({ pages: [] }));
  const repo = new WikipediaArticleRepository({ fetch, langs: ["en"], userAgent: "x" });
  const a = await repo.details("en", 7);
  assert.deepEqual(a, { id: "en:7", lang: "en", title: "Title 7", text: "Intro.", audio: null });
  await repo.details("en", 7);
  assert.equal(fetch.calls.length, 1);
});

test("wikipedia: finds the Spoken Wikipedia recording among the images, not pronunciations", async () => {
  const fetch = router(
    wikiRoutes({
      pages: [],
      images: [{ title: "Datei:Foo.jpg" }, { title: "Datei:Pron.ogg" }, { title: "Datei:Berlin.ogg" }],
      commons: {
        query: {
          pages: [
            { categories: [{ title: "Category:Pronunciation of German" }], imageinfo: [{ url: "https://c/pron.ogg" }] },
            {
              categories: [{ title: "Category:Spoken German Wikipedia" }],
              imageinfo: [{ url: "https://c/berlin.ogg" }],
            },
          ],
        },
      },
    }),
  );
  const a = await new WikipediaArticleRepository({ fetch, langs: ["en"], userAgent: "x" }).details("en", 1);
  assert.equal(a.audio, "https://c/berlin.ogg");
  assert.equal(new URL(fetch.calls[1][0]).searchParams.get("titles"), "File:Pron.ogg|File:Berlin.ogg");
});

test("offscreen audio: opens the document once and sends messages with the volumes", async () => {
  const chrome = makeChrome({ sendMessageResult: { ok: true } });
  const audio = new ChromeOffscreenAudio(chrome, async () => ({ ambient: 0.25, commentary: 1 }));
  assert.equal(await audio.isOpen(), false);
  assert.deepEqual(await audio.send({ type: "play", url: "u" }), { ok: true });
  await audio.send({ type: "pause" });
  assert.equal(chrome.offscreen.createDocument.calls.length, 1);
  assert.deepEqual(chrome.offscreen.createDocument.calls[0][0].reasons, ["AUDIO_PLAYBACK", "BLOBS"]);
  assert.deepEqual(chrome.runtime.sendMessage.calls[0][0], {
    target: "offscreen",
    volume: 0.25,
    commentaryVolume: 1,
    type: "play",
    url: "u",
  });
  assert.equal(await audio.isOpen(), true);
});
