importScripts("settings.js");

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab) return;
  if (msg?.type === "toggleFullscreen") toggleFullscreen(sender.tab.windowId);
  else if (msg?.type === "ambient") ambientAt(sender.tab.id, msg.lat, msg.lng);
  else if (msg?.type === "ambientStop") ambientStop(sender.tab.id);
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
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play ambient field recordings for the Street View location",
  });
}

async function toOffscreen(msg) {
  await ensureOffscreen();
  const { volume } = await chrome.storage.sync.get({ volume: SVG_DEFAULTS.volume });
  await chrome.runtime.sendMessage({ target: "offscreen", volume: volume / 100, ...msg });
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

chrome.tabs.onRemoved.addListener((tabId) => ambientStop(tabId));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.soundEnabled?.newValue === false) ambientStop();
  if (changes.volume && current) toOffscreen({ type: "volume" });
});
