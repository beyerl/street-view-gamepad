importScripts("settings.js");

chrome.runtime.onMessage.addListener((msg, sender) => {
  // From the offscreen document:
  if (msg?.type === "commentaryEnded") return commentaryEnded(msg.error);
  if (msg?.type === "commentaryNotice") return notice(msg.message);
  if (!sender.tab) return;
  if (msg?.type === "toggleFullscreen") toggleFullscreen(sender.tab.windowId);
  else if (msg?.type === "ambient") ambientAt(sender.tab.id, msg.lat, msg.lng);
  else if (msg?.type === "ambientStop") ambientStop(sender.tab.id);
  else if (msg?.type === "commentaryAt") commentaryAt(sender.tab.id, msg.lat, msg.lng);
  else if (msg?.type === "commentaryToggle") commentaryToggle(sender.tab.id);
  else if (msg?.type === "commentaryPause") commentaryPause(sender.tab.id);
});

// --- Fullscreen ---------------------------------------------------------------
// Toggles the browser window into/out of fullscreen. Done here rather than via
// element.requestFullscreen() because gamepad input does not count as a user
// gesture, so the page itself is not allowed to enter fullscreen.

async function toggleFullscreen(windowId) {
  const win = await chrome.windows.get(windowId);
  const key = `prevState:${windowId}`;

  if (win.state === "fullscreen") {
    const stored = await chrome.storage.session.get(key);
    const prev = stored[key] || "normal";
    await chrome.windows.update(windowId, { state: prev });
    await chrome.storage.session.remove(key);
  } else {
    await chrome.storage.session.set({ [key]: win.state });
    await chrome.windows.update(windowId, { state: "fullscreen" });
  }
}

// --- Ambient sound --------------------------------------------------------------
// Recordings come from radio aporee ::: maps (https://aporee.org/maps/), an open
// global sound map of field recordings. Its JSON API is what the map page itself
// uses; it only answers requests that carry the map page as Referer, which an
// extension can't set from fetch(), so a session rule adds it for our requests.

const APOREE_API = "https://aporee.org/api/maps/";
const LOCATIONS_KEY = "aporeeLocations";
const LOCATIONS_MAX_AGE = 7 * 24 * 3600 * 1000;

const rulesReady = chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "Referer", operation: "set", value: "https://aporee.org/maps/" },
        { header: "X-Requested-With", operation: "set", value: "XMLHttpRequest" },
      ],
    },
    condition: {
      urlFilter: "|https://aporee.org/api/maps/",
      initiatorDomains: [chrome.runtime.id],
      resourceTypes: ["xmlhttprequest", "other"],
    },
  }],
});

async function aporee(method, params = {}) {
  await rulesReady;
  const res = await fetch(`${APOREE_API}${method}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`aporee ${method}: HTTP ${res.status}`);
  return res.json();
}

// All ~70k recording locations as [locid, lat, lng], cached for a week.
let locations = null;

async function getLocations() {
  if (locations) return locations;
  const { [LOCATIONS_KEY]: cached } = await chrome.storage.local.get(LOCATIONS_KEY);
  if (cached && Date.now() - cached.fetchedAt < LOCATIONS_MAX_AGE) {
    return (locations = cached.data);
  }
  const all = await aporee("getAllLocations");
  const data = all.map((l) => [+l.locid, +(+l.lat).toFixed(5), +(+l.lng).toFixed(5)]);
  await chrome.storage.local.set({ [LOCATIONS_KEY]: { fetchedAt: Date.now(), data } });
  return (locations = data);
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return 6371 * Math.hypot(x, y);
}

function nearest(locs, lat, lng) {
  let best = null, bestD = Infinity;
  for (const loc of locs) {
    const d = distanceKm(lat, lng, loc[1], loc[2]);
    if (d < bestD) { bestD = d; best = loc; }
  }
  return { loc: best, km: bestD };
}

// What is playing (or paused) and for which tab. Kept in memory: if the worker
// is restarted, the next position update from the page simply starts over.
let current = null; // { tabId, locid, sound }
let requestSeq = 0;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    // Not only AUDIO_PLAYBACK, which closes the document after 30 s of silence
    // and with it a paused commentary or a voice still downloading.
    reasons: ["AUDIO_PLAYBACK", "BLOBS"],
    justification: "Play ambient field recordings and spoken articles for the Street View location",
  });
}

// Effective 0-1 volumes: each slider scaled by the master volume.
async function volumes() {
  const { masterVolume, volume, commentaryVolume } = await chrome.storage.sync.get({
    masterVolume: SVG_DEFAULTS.masterVolume,
    volume: SVG_DEFAULTS.volume,
    commentaryVolume: SVG_DEFAULTS.commentaryVolume,
  });
  return { ambient: (masterVolume / 100) * (volume / 100), commentary: (masterVolume / 100) * (commentaryVolume / 100) };
}

async function toOffscreen(msg) {
  await ensureOffscreen();
  const v = await volumes();
  return chrome.runtime.sendMessage({ target: "offscreen", volume: v.ambient, commentaryVolume: v.commentary, ...msg });
}

async function ambientAt(tabId, lat, lng) {
  const seq = ++requestSeq;
  const { soundEnabled } = await chrome.storage.sync.get({ soundEnabled: SVG_DEFAULTS.soundEnabled });
  if (!soundEnabled) return;

  try {
    const { loc, km } = nearest(await getLocations(), lat, lng);
    if (!loc || seq !== requestSeq) return;

    if (current?.locid === loc[0]) {
      current.tabId = tabId;
      await toOffscreen({ type: "play", url: current.sound.mp3 });
      return;
    }

    const sounds = await aporee("getPlaylist", { "locids[]": loc[0] });
    if (seq !== requestSeq || !Array.isArray(sounds) || !sounds.length) return;
    const sound = sounds[Math.floor(Math.random() * sounds.length)];

    current = { tabId, locid: loc[0], sound };
    await toOffscreen({ type: "play", url: sound.mp3 });
    await chrome.storage.session.set({
      nowPlaying: {
        title: sound.ctitle,
        place: sound.ltitle,
        artist: sound.artist,
        licence: sound.licence,
        recdate: sound.recdate,
        km: Math.round(km * 10) / 10,
        link: `https://aporee.org/maps/?loc=${loc[0]}`,
      },
    });
  } catch (err) {
    console.warn("ambient sound:", err);
  }
}

async function ambientStop(tabId) {
  if (!current || (tabId !== undefined && current.tabId !== tabId)) return;
  requestSeq++;
  await toOffscreen({ type: "pause" });
}

async function applyVolumes() {
  if (await offscreenOpen()) await toOffscreen({ type: "volume" });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  ambientStop(tabId);
  nearby.delete(tabId);
  lookupSeq.delete(tabId);
  if (noticeTab === tabId) noticeTab = null;
  if (playback?.tabId === tabId) commentaryStop();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.soundEnabled?.newValue === false) ambientStop();
  if (changes.volume || changes.masterVolume || changes.commentaryVolume) applyVolumes();
});

// --- Audio commentary -----------------------------------------------------------
// The Wikipedia article nearest to the position, from English Wikipedia or
// else the browser's language. If the article has a Spoken Wikipedia recording
// (a human reading it, hosted on Wikimedia Commons) that is played in the
// offscreen document; otherwise Piper (piper.js) reads the article's
// introduction there. Only started by the user (B in commentary mode), never
// automatically.

const WIKI_RADIUS = 500; // m around the position to look for an article
const WIKI_LANGS = [...new Set(["en", chrome.i18n.getUILanguage().split("-")[0]])];
const WIKI_HEADERS = { "Api-User-Agent": `StreetViewGamepad/${chrome.runtime.getManifest().version}` };

async function wikiApi(host, params) {
  const query = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
  const res = await fetch(`https://${host}/w/api.php?${query}`, { headers: WIKI_HEADERS });
  if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`);
  return res.json();
}

const articles = new Map(); // "lang:pageid" -> { id, lang, title, text, audio }

// The nearest article isn't always the interesting one (next to the
// Brandenburg Gate sits a club's office), so weigh article length against
// distance among the closest few.
async function nearestArticle(lat, lng) {
  for (const lang of WIKI_LANGS) {
    const { query } = await wikiApi(`${lang}.wikipedia.org`, {
      action: "query", generator: "geosearch", ggscoord: `${lat}|${lng}`, ggsradius: WIKI_RADIUS,
      ggslimit: 10, prop: "info|coordinates", codistancefrompoint: `${lat}|${lng}`,
    });
    const score = (p) => p.length / ((p.coordinates?.[0]?.dist ?? WIKI_RADIUS) + 100);
    const best = (query?.pages || []).sort((a, b) => score(b) - score(a))[0];
    if (best) return articleDetails(lang, best.pageid);
  }
  return null;
}

async function articleDetails(lang, pageid) {
  const id = `${lang}:${pageid}`;
  if (articles.has(id)) return articles.get(id);
  const { query } = await wikiApi(`${lang}.wikipedia.org`, {
    action: "query", pageids: pageid, prop: "extracts|images", exintro: 1, explaintext: 1, imlimit: "max",
  });
  const page = query.pages[0];
  const article = {
    id, lang, title: page.title, text: page.extract || "",
    audio: await spokenRecording(page.images || []),
  };
  articles.set(id, article);
  return article;
}

// URL of the article's Spoken Wikipedia recording: an audio file it embeds
// that Commons files as spoken (e.g. "Spoken German Wikipedia"); pronunciation
// clips aren't.
async function spokenRecording(images) {
  const files = images
    .map((i) => i.title.replace(/^[^:]+:/, "File:")) // "Datei:x.ogg" -> "File:x.ogg"
    .filter((t) => /\.(ogg|oga|opus|mp3|flac|wav)$/i.test(t))
    .slice(0, 20);
  if (!files.length) return null;
  const { query } = await wikiApi("commons.wikimedia.org", {
    action: "query", titles: files.join("|"), prop: "categories|imageinfo", iiprop: "url", cllimit: "max",
  });
  const spoken = query?.pages?.find((p) => p.categories?.some((c) => /spoken/i.test(c.title) && !/pronunciation/i.test(c.title)));
  return spoken?.imageinfo?.[0]?.url || null;
}

// Kept in memory like the ambient state: if the worker restarts, a paused
// commentary is forgotten and B starts the nearest article from the beginning.
const nearby = new Map(); // tabId -> article or null
const lookupSeq = new Map(); // tabId -> number, to drop stale lookups
let playback = null; // { tabId, article, status: "playing" | "paused" }
let noticeTab = null; // tab that sees download progress and errors

async function commentaryAt(tabId, lat, lng) {
  const seq = (lookupSeq.get(tabId) || 0) + 1;
  lookupSeq.set(tabId, seq);
  let article = null;
  try {
    article = await nearestArticle(lat, lng);
  } catch (err) {
    console.warn("commentary:", err);
  }
  if (lookupSeq.get(tabId) !== seq) return;
  nearby.set(tabId, article);
  pushCommentary(tabId);
  // Get the voice ready (downloaded on first use) before B is pressed.
  if (article && !article.audio) {
    noticeTab = tabId;
    toOffscreen({ type: "commentaryPreload", lang: article.lang }).catch(() => {});
  }
}

function pushCommentary(tabId) {
  const a = nearby.get(tabId);
  const p = playback?.tabId === tabId ? playback : null;
  chrome.tabs.sendMessage(tabId, {
    type: "commentary",
    state: {
      available: !!a, title: a?.title || "",
      status: p?.status || "stopped", playingTitle: p?.article.title || "",
    },
  }).catch(() => {}); // tab gone or reloading
}

// B: pause what plays; resume what is paused if it is still the nearest
// article; otherwise start the nearest article.
async function commentaryToggle(tabId) {
  const a = nearby.get(tabId);
  if (playback?.status === "playing") await commentaryPause();
  else if (playback?.tabId === tabId && (!a || a.id === playback.article.id)) await commentaryResume();
  else if (a) await commentaryStart(tabId, a);
  pushCommentary(tabId);
}

async function offscreenOpen() {
  return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length > 0;
}

async function commentaryStart(tabId, article) {
  await commentaryStop();
  playback = { tabId, article, status: "playing" };
  noticeTab = tabId;
  log(`commentary: ${article.title} (${article.audio ? "recording" : "text-to-speech"})`);
  if (article.audio) await toOffscreen({ type: "commentaryPlay", url: article.audio });
  else await toOffscreen({ type: "commentarySpeak", text: article.text || article.title, lang: article.lang });
}

async function commentaryResume() {
  const { tabId, article } = playback;
  playback.status = "playing";
  const res = await toOffscreen({ type: "commentaryResume" });
  if (!res?.ok) await commentaryStart(tabId, article); // offscreen document was recreated
}

async function commentaryPause(tabId) {
  if (playback?.status !== "playing" || (tabId !== undefined && playback.tabId !== tabId)) return;
  playback.status = "paused";
  await toOffscreen({ type: "commentaryPause" });
  pushCommentary(playback.tabId);
}

async function commentaryStop() {
  if (!playback) return;
  const { tabId } = playback;
  playback = null;
  if (await offscreenOpen()) await toOffscreen({ type: "commentaryStop" });
  pushCommentary(tabId);
}

async function commentaryEnded(error) {
  if (error) notice(error, 6000);
  if (!playback) return;
  const { tabId } = playback;
  playback = null;
  pushCommentary(tabId);
}

// A message box on the page: download progress, or why a commentary can't
// play. An empty message hides it; ms = 0 keeps it until replaced.
function notice(message, ms = 0) {
  if (message) log("commentary:", message);
  if (noticeTab === null) return;
  chrome.tabs.sendMessage(noticeTab, { type: "commentaryNotice", message, ms }).catch(() => {});
}

function log(...args) {
  console.log("[Street View Gamepad]", ...args);
}
