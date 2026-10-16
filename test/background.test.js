const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  loadScripts, plain, flush, spy, makeChrome, jsonResponse, errorResponse,
} = require("./helpers/env");

// routes: array of [predicate(url), body | (url) => body | Response]
function router(routes) {
  return spy(async (url) => {
    for (const [match, body] of routes) {
      if (!match(String(url))) continue;
      const out = typeof body === "function" ? body(String(url)) : body;
      return out && "ok" in out ? out : jsonResponse(out);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}
const has = (s) => (url) => url.includes(s);

function setup({ routes = [], ...chromeOpts } = {}) {
  const chrome = makeChrome(chromeOpts);
  const fetch = router(routes);
  const console = { log: spy(), warn: spy(), error: spy() };
  const env = loadScripts(["settings.js", "background.js"], { chrome, fetch, console, importScripts: () => {} });
  const messages = () => chrome.runtime.sendMessage.calls.map((c) => plain(c[0]));
  const toTab = () => chrome.tabs.sendMessage.calls;
  const route = (msg, tabId = 5, windowId = 9) => chrome.runtime.onMessage.emit(msg, { tab: { id: tabId, windowId } })[0];
  return { chrome, fetch, console, messages, toTab, route, ...env };
}

const LOCATIONS = [
  { locid: "1", lat: "52.52", lng: "13.405" }, // Berlin
  { locid: "2", lat: "48.8566", lng: "2.3522" }, // Paris
];
const SOUND = {
  mp3: "https://aporee.org/a.mp3", ctitle: "Dawn", ltitle: "Berlin", artist: "Jane",
  licence: "CC BY", recdate: "2020-05-01",
};
const aporeeRoutes = [
  [has("getAllLocations"), LOCATIONS],
  [has("getPlaylist"), [SOUND]],
];

// --- helpers -------------------------------------------------------------------

test("distanceKm: zero, one degree of latitude, and symmetry", () => {
  const { ev } = setup();
  const distanceKm = ev("distanceKm");
  assert.equal(distanceKm(10, 20, 10, 20), 0);
  assert.ok(Math.abs(distanceKm(0, 0, 1, 0) - 111.19) < 0.1);
  assert.ok(Math.abs(distanceKm(52, 13, 53, 14) - distanceKm(53, 14, 52, 13)) < 1e-9);
});

test("distanceKm: a degree of longitude shrinks towards the poles", () => {
  const { ev } = setup();
  const distanceKm = ev("distanceKm");
  assert.ok(distanceKm(0, 0, 0, 1) > distanceKm(60, 0, 60, 1) * 1.9);
});

test("nearest picks the closest location and reports its distance", () => {
  const { ev } = setup();
  const locs = [[1, 52.52, 13.405], [2, 48.85, 2.35], [3, 52.5, 13.4]];
  const { loc, km } = ev("nearest")(locs, 52.501, 13.401);
  assert.equal(loc[0], 3);
  assert.ok(km < 0.2);
});

test("nearest of nothing", () => {
  const { ev } = setup();
  const { loc, km } = ev("nearest")([], 1, 2);
  assert.equal(loc, null);
  assert.equal(km, Infinity);
});

// --- set-up --------------------------------------------------------------------

test("adds a session rule that sets the Referer for aporee requests", async () => {
  const { chrome } = setup();
  const [{ removeRuleIds, addRules }] = plain(chrome.declarativeNetRequest.updateSessionRules.calls[0]);
  assert.deepEqual(removeRuleIds, [1]);
  assert.equal(addRules[0].condition.initiatorDomains[0], "ext-id");
  assert.ok(addRules[0].action.requestHeaders.some((h) => h.header === "Referer"));
});

test("Wikipedia languages: English plus the browser's", () => {
  assert.deepEqual(plain(setup({ uiLanguage: "de-DE" }).ev("WIKI_LANGS")), ["en", "de"]);
  assert.deepEqual(plain(setup({ uiLanguage: "en-GB" }).ev("WIKI_LANGS")), ["en"]);
});

// --- message routing -----------------------------------------------------------

test("messages without a tab are ignored unless they come from the offscreen document", async () => {
  const { chrome, toTab } = setup();
  chrome.runtime.onMessage.emit({ type: "toggleFullscreen" }, {});
  chrome.runtime.onMessage.emit({ type: "ambient", lat: 1, lng: 2 }, {});
  await flush();
  assert.equal(chrome.windows.get.calls.length, 0);
  assert.equal(chrome.storage.sync.set.calls.length, 0);
  assert.equal(toTab().length, 0);
});

test("routes tab messages to their handlers", async () => {
  const { route, chrome, ev } = setup({ routes: aporeeRoutes });
  route({ type: "toggleFullscreen" }, 5, 9);
  await flush();
  assert.deepEqual(chrome.windows.get.calls[0], [9]);

  route({ type: "ambient", lat: 52.52, lng: 13.4 }, 5);
  await flush();
  assert.equal(ev("current").tabId, 5);

  route({ type: "ambientStop" }, 5);
  await flush();
  assert.ok(chrome.runtime.sendMessage.calls.some((c) => c[0].type === "pause"));
});

// --- fullscreen ----------------------------------------------------------------

test("fullscreen: enters fullscreen and remembers the previous state", async () => {
  const { chrome, ev } = setup();
  chrome.windows.get = spy(async () => ({ state: "maximized" }));
  await ev("toggleFullscreen")(9);
  assert.deepEqual(plain(chrome.windows.update.calls[0]), [9, { state: "fullscreen" }]);
  assert.equal(chrome.storage.session.data["prevState:9"], "maximized");
});

test("fullscreen: leaves it again and restores the previous state", async () => {
  const { chrome, ev } = setup({ session: { "prevState:9": "maximized" } });
  chrome.windows.get = spy(async () => ({ state: "fullscreen" }));
  await ev("toggleFullscreen")(9);
  assert.deepEqual(plain(chrome.windows.update.calls[0]), [9, { state: "maximized" }]);
  assert.equal("prevState:9" in chrome.storage.session.data, false);
});

test("fullscreen: falls back to normal when nothing was remembered", async () => {
  const { chrome, ev } = setup();
  chrome.windows.get = spy(async () => ({ state: "fullscreen" }));
  await ev("toggleFullscreen")(9);
  assert.deepEqual(plain(chrome.windows.update.calls[0]), [9, { state: "normal" }]);
});

// --- ambient sound -------------------------------------------------------------

test("ambient: plays the nearest recording and publishes its attribution", async () => {
  const { chrome, fetch, messages, ev } = setup({ routes: aporeeRoutes });
  await ev("ambientAt")(5, 52.51, 13.4);

  assert.ok(fetch.calls[0][0].includes("getAllLocations"));
  assert.ok(decodeURIComponent(fetch.calls[1][0]).includes("locids[]=1"));
  assert.equal(chrome.offscreen.createDocument.calls.length, 1);
  assert.deepEqual(messages().at(-1), {
    target: "offscreen", volume: 0.5, commentaryVolume: 1, type: "play", url: SOUND.mp3,
  });
  const np = chrome.storage.session.data.nowPlaying;
  assert.equal(np.title, "Dawn");
  assert.equal(np.place, "Berlin");
  assert.equal(np.link, "https://aporee.org/maps/?loc=1");
  assert.ok(np.km > 0 && np.km < 2);
  assert.equal(ev("current").locid, 1);
});

test("ambient: locations are cached in storage and in memory", async () => {
  const { chrome, fetch, ev } = setup({ routes: aporeeRoutes });
  await ev("ambientAt")(5, 52.51, 13.4);
  const cached = chrome.storage.local.data.aporeeLocations;
  assert.deepEqual(plain(cached.data), [[1, 52.52, 13.405], [2, 48.8566, 2.3522]]);

  await ev("ambientAt")(5, 48.85, 2.35);
  assert.equal(fetch.calls.filter((c) => c[0].includes("getAllLocations")).length, 1);
});

test("ambient: a fresh stored cache is used, a stale one is refetched", async () => {
  const fresh = setup({
    routes: aporeeRoutes,
    local: { aporeeLocations: { fetchedAt: Date.now(), data: [[9, 52.5, 13.4]] } },
  });
  await fresh.ev("ambientAt")(5, 52.5, 13.4);
  assert.equal(fresh.fetch.calls.some((c) => c[0].includes("getAllLocations")), false);
  assert.equal(fresh.ev("current").locid, 9);

  const stale = setup({
    routes: aporeeRoutes,
    local: { aporeeLocations: { fetchedAt: Date.now() - 8 * 24 * 3600 * 1000, data: [[9, 52.5, 13.4]] } },
  });
  await stale.ev("ambientAt")(5, 52.5, 13.4);
  assert.equal(stale.ev("current").locid, 1);
});

test("ambient: nothing happens when sound is disabled", async () => {
  const { fetch, chrome, ev } = setup({ routes: aporeeRoutes, sync: { soundEnabled: false } });
  await ev("ambientAt")(5, 52.5, 13.4);
  assert.equal(fetch.calls.length, 0);
  assert.equal(chrome.offscreen.createDocument.calls.length, 0);
});

test("ambient: the same place again just resumes the recording", async () => {
  const { fetch, messages, ev } = setup({ routes: aporeeRoutes });
  await ev("ambientAt")(5, 52.52, 13.405);
  const playlistCalls = () => fetch.calls.filter((c) => c[0].includes("getPlaylist")).length;
  assert.equal(playlistCalls(), 1);
  await ev("ambientAt")(6, 52.5201, 13.4051);
  assert.equal(playlistCalls(), 1);
  assert.equal(messages().at(-1).url, SOUND.mp3);
  assert.equal(ev("current").tabId, 6);
});

test("ambient: an empty playlist plays nothing", async () => {
  const { chrome, ev } = setup({ routes: [[has("getAllLocations"), LOCATIONS], [has("getPlaylist"), []]] });
  await ev("ambientAt")(5, 52.5, 13.4);
  assert.equal(ev("current"), null);
  assert.equal(chrome.storage.session.data.nowPlaying, undefined);
});

test("ambient: a failing request is logged, not thrown", async () => {
  const { console, ev } = setup({ routes: [[has("aporee"), errorResponse(503)]] });
  await ev("ambientAt")(5, 52.5, 13.4);
  assert.match(String(console.warn.calls[0][1]), /HTTP 503/);
});

test("ambient: a newer request supersedes an older one", async () => {
  const { messages, ev } = setup({ routes: aporeeRoutes });
  const first = ev("ambientAt")(5, 52.52, 13.405);
  const second = ev("ambientAt")(5, 48.85, 2.35);
  await Promise.all([first, second]);
  const plays = messages().filter((m) => m.type === "play");
  assert.equal(plays.length, 1);
  assert.equal(ev("current").locid, 2);
});

test("ambientStop: pauses only for the tab that is playing", async () => {
  const { messages, ev } = setup({ routes: aporeeRoutes });
  await ev("ambientStop")(5); // nothing playing yet
  assert.equal(messages().length, 0);

  await ev("ambientAt")(5, 52.52, 13.405);
  const before = messages().length;
  await ev("ambientStop")(6);
  assert.equal(messages().length, before);
  await ev("ambientStop")(5);
  assert.equal(messages().at(-1).type, "pause");
  await ev("ambientStop")(); // no tab: always
  assert.equal(messages().length, before + 2);
});

test("volumes: sliders are scaled by the master volume", async () => {
  const { messages, ev } = setup({
    routes: aporeeRoutes, sync: { masterVolume: 50, volume: 50, commentaryVolume: 100 },
  });
  await ev("ambientAt")(5, 52.52, 13.405);
  assert.equal(messages().at(-1).volume, 0.25);
  assert.equal(messages().at(-1).commentaryVolume, 0.5);
});

test("only one offscreen document is created", async () => {
  const { chrome, ev } = setup({ routes: aporeeRoutes });
  await ev("ambientAt")(5, 52.52, 13.405);
  await ev("ambientStop")(5);
  assert.equal(chrome.offscreen.createDocument.calls.length, 1);
});

// --- storage changes and closing tabs --------------------------------------------

test("turning sound off stops the recording", async () => {
  const { chrome, messages, ev } = setup({ routes: aporeeRoutes });
  await ev("ambientAt")(5, 52.52, 13.405);
  chrome.storage.onChanged.emit({ soundEnabled: { newValue: false } }, "sync");
  await flush();
  assert.equal(messages().at(-1).type, "pause");
});

test("volume changes are applied only while the offscreen document exists", async () => {
  const { chrome, messages } = setup();
  chrome.storage.onChanged.emit({ volume: { newValue: 10 } }, "sync");
  await flush();
  assert.equal(messages().length, 0);

  chrome.offscreenContexts.push({});
  chrome.storage.onChanged.emit({ masterVolume: { newValue: 10 } }, "sync");
  await flush();
  assert.equal(messages().at(-1).type, "volume");
});

test("storage changes in other areas are ignored", async () => {
  const { chrome, messages } = setup();
  chrome.offscreenContexts.push({});
  chrome.storage.onChanged.emit({ volume: { newValue: 10 }, soundEnabled: { newValue: false } }, "local");
  await flush();
  assert.equal(messages().length, 0);
});

test("closing the tab stops its sound and forgets its state", async () => {
  const { chrome, messages, ev } = setup({ routes: aporeeRoutes });
  await ev("ambientAt")(5, 52.52, 13.405);
  ev("nearby").set(5, { id: "x" });
  chrome.tabs.onRemoved.emit(5);
  await flush();
  assert.equal(messages().at(-1).type, "pause");
  assert.equal(ev("nearby").has(5), false);
});

// --- commentary ----------------------------------------------------------------

const wikiHost = (host) => (url) => url.startsWith(`https://${host}/`);
const wikiAction = (host, key) => (url) => wikiHost(host)(url) && url.includes(key);

function article({ pages, extract = "Intro text.", images = [], commons } = {}) {
  const routes = [
    [wikiAction("en.wikipedia.org", "generator=geosearch"), { query: { pages } }],
    [wikiAction("en.wikipedia.org", "prop=extracts"), (url) => {
      const id = new URL(url).searchParams.get("pageids");
      return { query: { pages: [{ pageid: +id, title: `Title ${id}`, extract, images }] } };
    }],
  ];
  if (commons) routes.push([wikiHost("commons.wikimedia.org"), commons]);
  return routes;
}

const NEAR = [
  { pageid: 1, length: 100, coordinates: [{ dist: 10 }] },
  { pageid: 2, length: 5000, coordinates: [{ dist: 100 }] },
];

test("commentary: picks the article that balances length and distance", async () => {
  const { toTab, ev } = setup({ routes: article({ pages: NEAR }) });
  await ev("commentaryAt")(5, 52.5, 13.4);
  assert.deepEqual(plain(toTab()[0]), [5, {
    type: "commentary",
    state: { available: true, title: "Title 2", status: "stopped", playingTitle: "", index: 0, count: 2 },
  }]);
});

test("commentary: asks the wiki API with the position and caches articles", async () => {
  const { fetch, ev } = setup({ routes: article({ pages: NEAR }) });
  await ev("commentaryAt")(5, 52.5, 13.4);
  const geo = new URL(fetch.calls[0][0]);
  assert.equal(geo.searchParams.get("ggscoord"), "52.5|13.4");
  assert.equal(fetch.calls[0][1].headers["Api-User-Agent"], "StreetViewGamepad/1.2.3");
  const count = fetch.calls.length;
  await ev("commentaryAt")(5, 52.5, 13.4);
  assert.equal(fetch.calls.length, count + 1); // only the geosearch, not the article again
});

test("commentary: without a recording the voice is preloaded", async () => {
  const { messages, ev } = setup({ routes: article({ pages: NEAR }) });
  await ev("commentaryAt")(5, 52.5, 13.4);
  await flush();
  assert.equal(messages().at(-1).type, "commentaryPreload");
  assert.equal(messages().at(-1).lang, "en");
});

test("commentary: falls back to the browser language when English has nothing", async () => {
  const { toTab, ev } = setup({
    uiLanguage: "de-DE",
    routes: [
      [wikiAction("en.wikipedia.org", "generator=geosearch"), { query: {} }],
      [wikiAction("de.wikipedia.org", "generator=geosearch"), { query: { pages: [{ pageid: 3, length: 10 }] } }],
      [wikiAction("de.wikipedia.org", "prop=extracts"), { query: { pages: [{ title: "Tor", extract: "Text" }] } }],
    ],
  });
  await ev("commentaryAt")(5, 52.5, 13.4);
  assert.equal(toTab()[0][1].state.title, "Tor");
  assert.equal(ev("nearby").get(5).lang, "de");
});

test("commentary: nothing nearby, or a failing API, means no commentary", async () => {
  const empty = setup({ routes: article({ pages: [] }) });
  await empty.ev("commentaryAt")(5, 52.5, 13.4);
  assert.equal(empty.toTab()[0][1].state.available, false);
  assert.equal(empty.ev("nearby").get(5), null);

  const failing = setup({ routes: [[wikiHost("en.wikipedia.org"), errorResponse(500)]] });
  await failing.ev("commentaryAt")(5, 52.5, 13.4);
  assert.equal(failing.toTab()[0][1].state.available, false);
  assert.match(String(failing.console.warn.calls[0][1]), /HTTP 500/);
});

test("commentary: finds a Spoken Wikipedia recording among the images", async () => {
  const { ev } = setup({
    routes: article({
      pages: [{ pageid: 1, length: 10 }],
      images: [
        { title: "Datei:Foo.jpg" },
        { title: "Datei:Pron.ogg" },
        { title: "Datei:Berlin.ogg" },
      ],
      commons: {
        query: {
          pages: [
            { categories: [{ title: "Category:Pronunciation of German" }], imageinfo: [{ url: "https://c/pron.ogg" }] },
            { categories: [{ title: "Category:Spoken German Wikipedia" }], imageinfo: [{ url: "https://c/berlin.ogg" }] },
          ],
        },
      },
    }),
  });
  await ev("commentaryAt")(5, 52.5, 13.4);
  assert.equal(ev("nearby").get(5).audio, "https://c/berlin.ogg");
});

test("commentary: a recording means no voice preload", async () => {
  const { messages, ev } = setup({
    routes: article({
      pages: [{ pageid: 1, length: 10 }],
      images: [{ title: "File:Berlin.ogg" }],
      commons: { query: { pages: [{ categories: [{ title: "Category:Spoken Wikipedia" }], imageinfo: [{ url: "u" }] }] } },
    }),
  });
  await ev("commentaryAt")(5, 52.5, 13.4);
  await flush();
  assert.equal(messages().length, 0);
});

test("commentary: a stale lookup is dropped", async () => {
  const { toTab, ev } = setup({ routes: article({ pages: NEAR }) });
  const first = ev("commentaryAt")(5, 52.5, 13.4);
  const second = ev("commentaryAt")(5, 52.6, 13.5);
  await Promise.all([first, second]);
  assert.equal(toTab().length, 1);
});

async function withArticle(opts = {}) {
  const env = setup({ routes: article({ pages: NEAR, ...opts }) });
  await env.ev("commentaryAt")(5, 52.5, 13.4);
  await flush();
  env.chrome.runtime.sendMessage.calls.length = 0;
  env.chrome.tabs.sendMessage.calls.length = 0;
  return env;
}
const lastState = (env) => env.toTab().at(-1)[1].state;

test("commentary toggle: starts the nearest article with text-to-speech", async () => {
  const env = await withArticle();
  await env.ev("commentaryToggle")(5);
  const msg = env.messages().at(-1);
  assert.equal(msg.type, "commentarySpeak");
  assert.equal(msg.text, "Intro text.");
  assert.equal(msg.lang, "en");
  assert.deepEqual(plain(lastState(env)), {
    available: true, title: "Title 2", status: "playing", playingTitle: "Title 2", index: 0, count: 2,
  });
});

test("commentary toggle: plays a recording when there is one", async () => {
  const env = await withArticle({
    images: [{ title: "File:A.ogg" }],
    commons: { query: { pages: [{ categories: [{ title: "Category:Spoken Wikipedia" }], imageinfo: [{ url: "https://c/a.ogg" }] }] } },
  });
  await env.ev("commentaryToggle")(5);
  assert.equal(env.messages().at(-1).type, "commentaryPlay");
  assert.equal(env.messages().at(-1).url, "https://c/a.ogg");
});

test("commentary toggle: pauses, then resumes", async () => {
  const env = await withArticle();
  await env.ev("commentaryToggle")(5);
  await env.ev("commentaryToggle")(5);
  assert.equal(env.messages().at(-1).type, "commentaryPause");
  assert.equal(lastState(env).status, "paused");
  assert.equal(lastState(env).playingTitle, "Title 2");

  env.chrome.runtime.sendMessage = spy(async () => ({ ok: true }));
  await env.ev("commentaryToggle")(5);
  assert.equal(env.chrome.runtime.sendMessage.calls.at(-1)[0].type, "commentaryResume");
  assert.equal(lastState(env).status, "playing");
});

test("commentary toggle: starts over when the offscreen document lost the commentary", async () => {
  const env = await withArticle();
  await env.ev("commentaryToggle")(5);
  await env.ev("commentaryToggle")(5); // pause
  env.chrome.runtime.sendMessage = spy(async () => ({ ok: false }));
  await env.ev("commentaryToggle")(5);
  const types = env.chrome.runtime.sendMessage.calls.map((c) => c[0].type);
  assert.deepEqual(types, ["commentaryResume", "commentaryStop", "commentarySpeak"]);
});

test("commentary toggle: with nothing nearby does nothing but report the state", async () => {
  const env = setup({ routes: article({ pages: [] }) });
  await env.ev("commentaryAt")(5, 52.5, 13.4);
  await env.ev("commentaryToggle")(5);
  assert.equal(env.messages().length, 0);
  assert.equal(env.ev("playback"), null);
});

test("commentary pause: only pauses what plays, for the right tab", async () => {
  const env = await withArticle();
  await env.ev("commentaryPause")(5); // nothing playing
  assert.equal(env.messages().length, 0);

  await env.ev("commentaryToggle")(5);
  await env.ev("commentaryPause")(6); // other tab
  assert.equal(env.ev("playback").status, "playing");
  await env.ev("commentaryPause")(5);
  assert.equal(env.ev("playback").status, "paused");
});

test("commentary stop: tells the offscreen document only if it is open", async () => {
  const env = await withArticle();
  await env.ev("commentaryToggle")(5);
  env.chrome.runtime.sendMessage.calls.length = 0;
  env.chrome.offscreenContexts.length = 0; // the document was closed meanwhile
  await env.ev("commentaryStop")();
  assert.equal(env.messages().length, 0);
  assert.equal(env.ev("playback"), null);

  await env.ev("commentaryToggle")(5); // opens the document again
  await env.ev("commentaryStop")();
  assert.equal(env.messages().at(-1).type, "commentaryStop");
});

test("commentary ended: clears the playback, and shows an error", async () => {
  const env = await withArticle();
  await env.ev("commentaryToggle")(5);
  env.chrome.tabs.sendMessage.calls.length = 0;
  await env.route({ type: "commentaryEnded", error: "boom" }, undefined);
  assert.equal(env.ev("playback"), null);
  const sentToTab = env.toTab().map((c) => c[1]);
  assert.deepEqual(plain(sentToTab[0]), { type: "commentaryNotice", message: "boom", ms: 6000 });
  assert.equal(sentToTab.at(-1).type, "commentary");
  assert.equal(sentToTab.at(-1).state.status, "stopped");
});

test("notices from the offscreen document reach the tab that started the commentary", async () => {
  const env = await withArticle();
  await env.ev("commentaryToggle")(5);
  env.chrome.runtime.onMessage.emit({ type: "commentaryNotice", message: "Downloading…" }, {});
  assert.deepEqual(plain(env.toTab().at(-1)), [5, { type: "commentaryNotice", message: "Downloading…", ms: 0 }]);
});

test("notices go nowhere when no tab asked for commentary", () => {
  const env = setup();
  env.chrome.runtime.onMessage.emit({ type: "commentaryNotice", message: "hi" }, {});
  assert.equal(env.toTab().length, 0);
});

test("closing the tab that plays commentary stops it", async () => {
  const env = await withArticle();
  await env.ev("commentaryToggle")(5);
  env.chrome.tabs.onRemoved.emit(5);
  await flush();
  assert.equal(env.ev("playback"), null);
  assert.equal(env.ev("noticeTab"), null);
});

test("commentary next: goes through the articles nearby, wrapping around", async () => {
  const env = await withArticle();
  await env.ev("commentaryNext")(5, 1);
  assert.deepEqual(plain(lastState(env)), {
    available: true, title: "Title 1", status: "stopped", playingTitle: "", index: 1, count: 2,
  });
  await env.ev("commentaryNext")(5, 1);
  assert.equal(lastState(env).title, "Title 2");
  await env.ev("commentaryNext")(5, -1);
  assert.equal(lastState(env).title, "Title 1");
  assert.equal(env.ev("nearby").get(5).title, "Title 1");
});

test("commentary next: while playing, the new article plays", async () => {
  const env = await withArticle();
  await env.ev("commentaryToggle")(5);
  await env.ev("commentaryNext")(5, 1);
  assert.equal(env.messages().at(-1).type, "commentarySpeak");
  assert.equal(lastState(env).playingTitle, "Title 1");
  assert.equal(lastState(env).status, "playing");
});

test("commentary next: with only one article nearby nothing changes", async () => {
  const env = setup({ routes: article({ pages: [{ pageid: 1, length: 100 }] }) });
  await env.ev("commentaryAt")(5, 52.5, 13.4);
  await env.ev("commentaryNext")(5, 1);
  assert.equal(lastState(env).title, "Title 1");
  assert.equal(lastState(env).count, 1);
});

test("commentary next: routed from the tab", async () => {
  const env = await withArticle();
  env.route({ type: "commentaryNext", step: -1 });
  await flush();
  assert.equal(lastState(env).title, "Title 1");
});
