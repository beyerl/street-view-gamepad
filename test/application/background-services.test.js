import { test } from "node:test";
import assert from "node:assert/strict";
import { AmbientService } from "../../src/application/ambient-service.js";
import { CommentaryService } from "../../src/application/commentary-service.js";
import { FullscreenService } from "../../src/application/fullscreen-service.js";
import { ArticlePlaylist } from "../../src/domain/articles.js";
import { GeoPoint } from "../../src/domain/geo.js";
import { Msg, OffscreenMsg } from "../../src/shared/messages.js";
import { StorageKey } from "../../src/shared/storage-keys.js";
import { flush, makeChrome, spy, storageArea } from "../helpers/fakes.js";

const BERLIN = new GeoPoint(52.5, 13.4);

function fakeAudio({ open = true, resume = { ok: true } } = {}) {
  const audio = {
    open,
    sent: [],
    send: spy(async (msg) => {
      audio.sent.push(msg);
      return msg.type === OffscreenMsg.COMMENTARY_RESUME ? resume : undefined;
    }),
    isOpen: async () => audio.open,
    types: () => audio.sent.map((m) => m.type),
  };
  return audio;
}

// --- fullscreen -------------------------------------------------------------------------

test("fullscreen: enters it remembering the state, and restores that state", async () => {
  const chrome = makeChrome();
  const fs = new FullscreenService(chrome.windows, chrome.storage.session);
  chrome.windows.get = async () => ({ state: "maximized" });
  await fs.toggle(9);
  assert.deepEqual(chrome.windows.update.calls[0], [9, { state: "fullscreen" }]);
  assert.equal(chrome.storage.session.data[StorageKey.prevWindowState(9)], "maximized");
  chrome.windows.get = async () => ({ state: "fullscreen" });
  await fs.toggle(9);
  assert.deepEqual(chrome.windows.update.calls[1], [9, { state: "maximized" }]);
  assert.equal(StorageKey.prevWindowState(9) in chrome.storage.session.data, false);
  await fs.toggle(9);
  assert.deepEqual(chrome.windows.update.calls[2], [9, { state: "normal" }]); // nothing remembered
});

// --- ambient ----------------------------------------------------------------------------

const SOUND = {
  mp3: "https://aporee.org/a.mp3",
  ctitle: "Dawn",
  ltitle: "Berlin",
  artist: "Jane",
  licence: "CC BY",
  recdate: "2020-05-01",
};

function ambientSetup({
  enabled = true,
  locations = [
    [1, 52.52, 13.405],
    [2, 48.8566, 2.3522],
  ],
  sounds = [SOUND],
} = {}) {
  const audio = fakeAudio();
  const session = storageArea();
  const recordings = { locations: spy(async () => locations), playlist: spy(async () => sounds) };
  const warn = spy();
  const svc = new AmbientService({
    recordings,
    audio,
    soundEnabled: async () => enabled,
    session,
    random: () => 0,
    warn,
  });
  return { svc, audio, session, recordings, warn };
}

test("ambient: plays the nearest recording and publishes its attribution", async () => {
  const env = ambientSetup();
  await env.svc.at(5, BERLIN);
  assert.deepEqual(env.audio.sent, [{ type: OffscreenMsg.PLAY, url: SOUND.mp3 }]);
  assert.deepEqual(env.recordings.playlist.calls, [[1]]);
  assert.deepEqual(env.session.data[StorageKey.NOW_PLAYING], {
    title: "Dawn",
    place: "Berlin",
    artist: "Jane",
    licence: "CC BY",
    recdate: "2020-05-01",
    km: 2.2,
    link: "https://aporee.org/maps/?loc=1",
  });
});

test("ambient: the same place again resumes without a new playlist; disabled or empty plays nothing", async () => {
  const env = ambientSetup();
  await env.svc.at(5, BERLIN);
  await env.svc.at(6, BERLIN);
  assert.equal(env.recordings.playlist.calls.length, 1);
  assert.equal(env.audio.sent.length, 2);
  assert.equal(env.svc.current.tabId, 6);

  const off = ambientSetup({ enabled: false });
  await off.svc.at(5, BERLIN);
  const empty = ambientSetup({ sounds: [] });
  await empty.svc.at(5, BERLIN);
  assert.equal(off.audio.sent.length + empty.audio.sent.length, 0);
});

test("ambient: errors are logged; a newer request supersedes an older one", async () => {
  const env = ambientSetup();
  env.recordings.locations = async () => {
    throw new Error("HTTP 500");
  };
  await env.svc.at(5, BERLIN);
  assert.match(String(env.warn.calls[0][1]), /HTTP 500/);

  const race = ambientSetup();
  const first = race.svc.at(5, BERLIN);
  const second = race.svc.at(5, new GeoPoint(48.85, 2.35));
  await Promise.all([first, second]);
  assert.equal(race.recordings.playlist.calls.length, 1);
  assert.deepEqual(race.recordings.playlist.calls[0], [2]);
});

test("ambient: stop pauses only the playing tab (or any); volumes only while open", async () => {
  const env = ambientSetup();
  await env.svc.stop(5);
  await env.svc.at(5, BERLIN);
  await env.svc.stop(6);
  await env.svc.stop(5);
  await env.svc.stop();
  assert.deepEqual(env.audio.types(), [OffscreenMsg.PLAY, OffscreenMsg.PAUSE, OffscreenMsg.PAUSE]);
  await env.svc.applyVolumes();
  env.audio.open = false;
  await env.svc.applyVolumes();
  assert.equal(env.audio.types().filter((t) => t === OffscreenMsg.VOLUME).length, 1);
});

// --- commentary -------------------------------------------------------------------------

const art = (pageid, audio = null) => ({
  id: `en:${pageid}`,
  lang: "en",
  title: `Title ${pageid}`,
  text: "Intro text.",
  audio,
});

function commentarySetup({ pageids = [2, 1], audioOf = {}, open = true, resume } = {}) {
  const audio = fakeAudio({ open, resume });
  const articles = {
    nearby: spy(async () => (pageids.length ? new ArticlePlaylist("en", [...pageids]) : null)),
    details: spy(async (lang, id) => art(id, audioOf[id] || null)),
  };
  const toTab = [];
  const sendToTab = spy(async (tabId, msg) => toTab.push([tabId, msg]));
  const warn = spy();
  const svc = new CommentaryService({ articles, audio, sendToTab, log: () => {}, warn });
  const last = (tabId = 5) => toTab.filter(([t, m]) => t === tabId && m.type === Msg.COMMENTARY).at(-1)?.[1].state;
  return { svc, audio, articles, toTab, sendToTab, warn, last };
}

async function withArticle(opts) {
  const env = commentarySetup(opts);
  await env.svc.lookup(5, BERLIN);
  await flush();
  env.audio.sent.length = 0;
  return env;
}

test("commentary: a lookup reports the best article, numbered among those nearby, and preloads the voice", async () => {
  const env = commentarySetup();
  await env.svc.lookup(5, BERLIN);
  assert.deepEqual(env.last(), {
    available: true,
    title: "Title 2",
    status: "stopped",
    playingTitle: "",
    index: 0,
    count: 2,
  });
  assert.deepEqual(env.audio.sent, [{ type: OffscreenMsg.COMMENTARY_PRELOAD, lang: "en" }]);
  assert.equal(env.svc.noticeTab, 5);
});

test("commentary: a recording needs no voice; nothing nearby or errors mean no commentary", async () => {
  const rec = commentarySetup({ audioOf: { 2: "https://c/a.ogg" } });
  await rec.svc.lookup(5, BERLIN);
  assert.equal(rec.audio.sent.length, 0);

  const none = commentarySetup({ pageids: [] });
  await none.svc.lookup(5, BERLIN);
  assert.equal(none.last().available, false);

  const failing = commentarySetup();
  failing.articles.nearby = async () => {
    throw new Error("HTTP 500");
  };
  await failing.svc.lookup(5, BERLIN);
  assert.equal(failing.last().available, false);
  assert.match(String(failing.warn.calls[0][1]), /HTTP 500/);
});

test("commentary: a stale lookup is dropped", async () => {
  const env = commentarySetup();
  await Promise.all([env.svc.lookup(5, BERLIN), env.svc.lookup(5, BERLIN)]);
  assert.equal(env.toTab.filter(([, m]) => m.type === Msg.COMMENTARY).length, 1);
});

test("commentary: toggle starts text-to-speech, pauses, resumes", async () => {
  const env = await withArticle();
  await env.svc.toggle(5);
  assert.deepEqual(env.audio.sent, [{ type: OffscreenMsg.COMMENTARY_SPEAK, text: "Intro text.", lang: "en" }]);
  assert.deepEqual(env.last(), {
    available: true,
    title: "Title 2",
    status: "playing",
    playingTitle: "Title 2",
    index: 0,
    count: 2,
  });
  await env.svc.toggle(5);
  assert.equal(env.last().status, "paused");
  await env.svc.toggle(5);
  assert.equal(env.last().status, "playing");
  assert.deepEqual(env.audio.types().slice(1), [OffscreenMsg.COMMENTARY_PAUSE, OffscreenMsg.COMMENTARY_RESUME]);
});

test("commentary: a recording plays as such; a lost offscreen document starts over", async () => {
  const env = await withArticle({ audioOf: { 2: "https://c/a.ogg" }, resume: { ok: false } });
  await env.svc.toggle(5);
  assert.deepEqual(env.audio.sent[0], { type: OffscreenMsg.COMMENTARY_PLAY, url: "https://c/a.ogg" });
  await env.svc.toggle(5);
  await env.svc.toggle(5);
  assert.deepEqual(env.audio.types().slice(-3), [
    OffscreenMsg.COMMENTARY_RESUME,
    OffscreenMsg.COMMENTARY_STOP,
    OffscreenMsg.COMMENTARY_PLAY,
  ]);
});

test("commentary: toggling with nothing nearby only reports the state", async () => {
  const env = commentarySetup({ pageids: [] });
  await env.svc.lookup(5, BERLIN);
  await env.svc.toggle(5);
  assert.equal(env.audio.sent.length, 0);
  assert.equal(env.toTab.length, 2);
});

test("commentary: pause only pauses what plays, for the right tab", async () => {
  const env = await withArticle();
  await env.svc.pause(5);
  await env.svc.toggle(5);
  await env.svc.pause(6);
  assert.equal(env.last().status, "playing");
  await env.svc.pause(5);
  assert.equal(env.last().status, "paused");
  assert.equal(env.last(6), undefined); // another tab never sees it as its own
});

test("commentary: next goes through the articles, wrapping, and a playing one switches", async () => {
  const env = await withArticle();
  await env.svc.next(5, 1);
  assert.equal(env.last().title, "Title 1");
  assert.equal(env.last().index, 1);
  await env.svc.next(5, 1);
  assert.equal(env.last().title, "Title 2");
  await env.svc.toggle(5);
  await env.svc.next(5, -1);
  assert.equal(env.last().playingTitle, "Title 1");
  assert.equal(env.audio.types().at(-2), OffscreenMsg.COMMENTARY_SPEAK);
});

test("commentary: next with one article, or failing, changes nothing", async () => {
  const one = await withArticle({ pageids: [1] });
  await one.svc.next(5, 1);
  assert.equal(one.last().title, "Title 1");
  const failing = await withArticle();
  failing.articles.details = async () => {
    throw new Error("down");
  };
  await failing.svc.next(5, 1);
  assert.equal(failing.last().title, "Title 2");
  assert.equal(failing.warn.calls.length, 1);
});

test("commentary: ended clears playback and shows errors to the tab that started it", async () => {
  const env = await withArticle();
  await env.svc.toggle(5);
  env.svc.ended("Text-to-speech failed: boom");
  assert.equal(env.last().status, "stopped");
  assert.deepEqual(env.toTab.find(([, m]) => m.type === Msg.COMMENTARY_NOTICE)[1], {
    type: Msg.COMMENTARY_NOTICE,
    message: "Text-to-speech failed: boom",
    ms: 6000,
  });
  env.svc.ended(); // nothing playing: nothing to do
  const nobody = commentarySetup();
  nobody.svc.notice("x");
  assert.equal(nobody.toTab.length, 0);
});

test("commentary: stop tells the offscreen document only if it is open; closing the tab stops it", async () => {
  const env = await withArticle({ open: false });
  await env.svc.toggle(5);
  await env.svc.stop();
  assert.equal(env.audio.types().includes(OffscreenMsg.COMMENTARY_STOP), false);

  const closing = await withArticle();
  await closing.svc.toggle(5);
  closing.svc.forgetTab(5);
  await flush();
  assert.equal(closing.audio.types().at(-1), OffscreenMsg.COMMENTARY_STOP);
  assert.equal(closing.svc.nearbyFor(5), null);
  assert.equal(closing.svc.noticeTab, null);
});
