// Composition root of the background service worker.

import { GeoPoint } from "../domain/geo.js";
import { DEFAULT_SETTINGS, effectiveVolumes, withDefaults } from "../domain/settings.js";
import { AmbientService } from "../application/ambient-service.js";
import { CommentaryService } from "../application/commentary-service.js";
import { FullscreenService } from "../application/fullscreen-service.js";
import { AporeeRecordingRepository, aporeeRule } from "../infrastructure/aporee-recording-repository.js";
import { ChromeOffscreenAudio } from "../infrastructure/chrome-offscreen-audio.js";
import { plainLogger } from "../infrastructure/logger.js";
import { WikipediaArticleRepository } from "../infrastructure/wikipedia-article-repository.js";
import { Msg } from "../shared/messages.js";

/** @param {{ chrome: typeof globalThis.chrome, fetch: typeof globalThis.fetch, console: Console, random?: () => number, now?: () => number }} g */
export function startBackground({ chrome, fetch, console, random = Math.random, now = Date.now }) {
  const log = plainLogger(console);
  const warn = (/** @type {any[]} */ ...a) => console.warn(...a);
  const settings = async () => withDefaults(await chrome.storage.sync.get(null));

  const audio = new ChromeOffscreenAudio(chrome, async () => effectiveVolumes(await settings()));
  const ready = chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [aporeeRule("").id],
    addRules: [/** @type {any} */ (aporeeRule(chrome.runtime.id))],
  });
  const recordings = new AporeeRecordingRepository({ fetch, cache: chrome.storage.local, ready, now });
  const langs = [...new Set(["en", chrome.i18n.getUILanguage().split("-")[0]])];
  const articles = new WikipediaArticleRepository({
    fetch,
    langs,
    userAgent: `StreetViewGamepad/${chrome.runtime.getManifest().version}`,
  });

  const fullscreen = new FullscreenService(chrome.windows, chrome.storage.session);
  const ambient = new AmbientService({
    recordings,
    audio,
    soundEnabled: async () => (await settings()).soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
    session: chrome.storage.session,
    random,
    warn,
  });
  const sendToTab = (/** @type {number} */ tabId, /** @type {any} */ msg) => chrome.tabs.sendMessage(tabId, msg);
  const commentary = new CommentaryService({ articles, audio, sendToTab, log, warn });

  /** Messages from tabs, by type. @type {Record<string, (tab: chrome.tabs.Tab, msg: any) => unknown>} */
  const fromTab = {
    [Msg.TOGGLE_FULLSCREEN]: (tab) => fullscreen.toggle(tab.windowId),
    [Msg.AMBIENT]: (tab, msg) => ambient.at(tab.id, new GeoPoint(msg.lat, msg.lng)),
    [Msg.AMBIENT_STOP]: (tab) => ambient.stop(tab.id),
    [Msg.COMMENTARY_AT]: (tab, msg) => commentary.lookup(tab.id, new GeoPoint(msg.lat, msg.lng)),
    [Msg.COMMENTARY_TOGGLE]: (tab) => commentary.toggle(tab.id),
    [Msg.COMMENTARY_PAUSE]: (tab) => commentary.pause(tab.id),
    [Msg.COMMENTARY_NEXT]: (tab, msg) => commentary.next(tab.id, msg.step),
  };

  chrome.runtime.onMessage.addListener((msg, sender) => {
    // From the offscreen document:
    if (msg?.type === Msg.COMMENTARY_ENDED) return void commentary.ended(msg.error);
    if (msg?.type === Msg.COMMENTARY_NOTICE) return void commentary.notice(msg.message);
    if (sender.tab) fromTab[msg?.type]?.(sender.tab, msg);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    ambient.stop(tabId);
    commentary.forgetTab(tabId);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.soundEnabled?.newValue === false) ambient.stop();
    if (changes.volume || changes.masterVolume || changes.commentaryVolume) ambient.applyVolumes();
  });

  return { fullscreen, ambient, commentary, recordings, articles, audio, langs };
}
