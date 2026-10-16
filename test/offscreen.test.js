const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts, plain, flush, spy, makeChrome, makeClock } = require("./helpers/env");
const { makeDocument } = require("./helpers/dom");

function setup() {
  const chrome = makeChrome();
  const clock = makeClock();
  const document = makeDocument({ audioIds: ["a", "b", "c"] });
  const Piper = { preload: spy(async () => {}), speak: async function* () {} };
  let blobs = 0;
  const URL = { createObjectURL: spy(() => `blob:${++blobs}`), revokeObjectURL: spy() };
  const env = loadScripts(["offscreen.js"], { chrome, document, Piper, URL, ...clock.globals });

  const [a, b, c] = ["a", "b", "c"].map(document.el);
  const listener = chrome.runtime.onMessage.fns[0];
  const send = (msg) => {
    let response;
    const result = listener({ target: "offscreen", ...msg }, {}, (r) => { response = r; });
    return { response, result };
  };
  const sent = () => chrome.runtime.sendMessage.calls.map((call) => plain(call[0]));
  return { chrome, clock, document, Piper, URL, players: [a, b], commentary: c, listener, send, sent, ...env };
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

// --- ambient ---------------------------------------------------------------------

test("ignores messages for other targets", () => {
  const { listener, players, clock } = setup();
  assert.equal(listener({ type: "play", url: "u" }, {}, () => {}), undefined);
  assert.equal(listener(undefined, {}, () => {}), undefined);
  clock.tick(2000);
  assert.equal(players[0].playCalls + players[1].playCalls, 0);
});

test("play starts the recording on the idle player and fades it in", () => {
  const { send, players, clock } = setup();
  send({ type: "play", url: "u1", volume: 0.8 });
  const next = players[1]; // the first switch goes from player 0 to player 1
  assert.equal(next.src, "u1");
  assert.equal(next.playCalls, 1);
  assert.equal(next.volume, 0);
  clock.tick(750);
  near(next.volume, 0.4);
  clock.tick(900);
  near(next.volume, 0.8);
});

test("a different recording crossfades: the old one fades out and is paused", () => {
  const { send, players, clock } = setup();
  send({ type: "play", url: "u1", volume: 1 });
  clock.tick(2000);
  send({ type: "play", url: "u2", volume: 1 });
  assert.equal(players[0].src, "u2");
  clock.tick(750);
  near(players[1].volume, 0.5);
  assert.equal(players[1].paused, false);
  clock.tick(900);
  assert.equal(players[1].volume, 0);
  assert.equal(players[1].paused, true);
  near(players[0].volume, 1);
});

test("play of the same recording resumes it where it was paused", () => {
  const { send, players, clock } = setup();
  send({ type: "play", url: "u1", volume: 0.6 });
  clock.tick(2000);
  send({ type: "pause" });
  clock.tick(2000);
  assert.equal(players[1].paused, true);
  assert.equal(players[1].volume, 0);

  send({ type: "play", url: "u1", volume: 0.6 });
  assert.equal(players[1].playCalls, 2);
  clock.tick(2000);
  near(players[1].volume, 0.6);
  assert.equal(players[1].src, "u1");
});

test("a failing ambient play() is only logged", async () => {
  const { send, players, ctx } = setup();
  players[1].playError = new Error("blocked");
  send({ type: "play", url: "u1" });
  await flush();
  assert.equal(ctx.console.warn.calls.length, 1);
  assert.equal(players[1].src, "u1");
});

test("volume message changes the playing recording's level", () => {
  const { send, players, clock } = setup();
  send({ type: "play", url: "u1", volume: 1 });
  clock.tick(2000);
  send({ type: "volume", volume: 0.3 });
  clock.tick(2000);
  near(players[1].volume, 0.3);
});

test("volume message does not start a paused player", () => {
  const { send, players, clock } = setup();
  send({ type: "volume", volume: 0.3 });
  clock.tick(2000);
  assert.equal(players[0].volume, 1);
  assert.equal(players[0].playCalls, 0);
});

test("status reports the active player", () => {
  const { send, players, clock } = setup();
  send({ type: "play", url: "u1", volume: 0.5 });
  clock.tick(2000);
  players[1].currentTime = 12;
  assert.deepEqual(plain(send({ type: "status" }).response), {
    src: "u1", paused: false, currentTime: 12, volume: 0.5,
  });
});

test("pause fades both players out and pauses them", () => {
  const { send, players, clock } = setup();
  send({ type: "play", url: "u1", volume: 1 });
  clock.tick(2000);
  send({ type: "pause" });
  clock.tick(2000);
  assert.deepEqual(players.map((p) => p.paused), [true, true]);
  assert.equal(players[1].volume, 0);
});

// --- commentary: recordings ------------------------------------------------------------

test("a commentary recording plays at its own volume and ducks the ambient sound", () => {
  const { send, players, commentary, clock } = setup();
  send({ type: "play", url: "u1", volume: 0.8 });
  clock.tick(2000);
  send({ type: "commentaryPlay", url: "https://c/a.ogg", commentaryVolume: 0.6 });
  assert.equal(commentary.src, "https://c/a.ogg");
  assert.equal(commentary.volume, 0.6);
  assert.equal(commentary.playCalls, 1);
  clock.tick(2000);
  near(players[1].volume, 0.2); // 0.8 * DUCK
});

test("stopping the commentary clears it and restores the ambient volume", () => {
  const { send, players, commentary, clock } = setup();
  send({ type: "play", url: "u1", volume: 0.8 });
  send({ type: "commentaryPlay", url: "https://c/a.ogg" });
  clock.tick(2000);
  send({ type: "commentaryStop" });
  assert.equal(commentary.src, "");
  assert.equal(commentary.paused, true);
  assert.equal(commentary.loadCalls >= 1, true);
  clock.tick(2000);
  near(players[1].volume, 0.8);
});

test("the end of a recording is reported", () => {
  const { send, commentary, sent } = setup();
  send({ type: "commentaryPlay", url: "https://c/a.ogg" });
  commentary.dispatchEvent({ type: "ended" });
  assert.deepEqual(sent(), [{ type: "commentaryEnded" }]);
  assert.equal(commentary.src, "");
});

test("a recording that cannot be played is reported with the reason", async () => {
  const { send, commentary, sent } = setup();
  commentary.playError = new Error("denied");
  send({ type: "commentaryPlay", url: "https://c/a.ogg" });
  await flush();
  assert.deepEqual(sent(), [{ type: "commentaryEnded", error: "Commentary could not be played: denied" }]);
});

test("pause and resume of a recording", () => {
  const { send, commentary } = setup();
  send({ type: "commentaryPlay", url: "https://c/a.ogg" });
  send({ type: "commentaryPause" });
  assert.equal(commentary.paused, true);
  assert.deepEqual(plain(send({ type: "commentaryResume" }).response), { ok: true });
  assert.equal(commentary.paused, false);
  assert.equal(commentary.playCalls, 2);
});

test("resume reports failure when there is nothing to resume", () => {
  const { send, commentary } = setup();
  assert.deepEqual(plain(send({ type: "commentaryResume" }).response), { ok: false });
  assert.equal(commentary.playCalls, 0);
});

// --- commentary: text-to-speech --------------------------------------------------------

const sentences = (...blobs) => async function* () { yield* blobs; };

test("speech: plays the synthesized sentences one after the other, then reports the end", async () => {
  const { send, commentary, Piper, URL, sent } = setup();
  Piper.speak = spy(sentences("s1", "s2"));
  send({ type: "commentarySpeak", text: "One. Two.", lang: "de" });
  await flush();

  assert.deepEqual(Piper.speak.calls[0], ["One. Two.", "de"]);
  assert.equal(commentary.src, "blob:1");
  assert.equal(commentary.playCalls, 1);
  assert.deepEqual(sent(), [{ type: "commentaryNotice", message: "" }]); // clears "Downloading…"

  commentary.dispatchEvent({ type: "ended" });
  assert.equal(commentary.src, "blob:2");
  assert.deepEqual(URL.revokeObjectURL.calls[0], ["blob:1"]);
  assert.equal(sent().length, 1);

  commentary.dispatchEvent({ type: "ended" });
  assert.deepEqual(sent().at(-1), { type: "commentaryEnded" });
  assert.equal(commentary.src, "");
});

test("speech: synthesizes only a couple of sentences ahead of playback", async () => {
  const { send, commentary, clock, Piper, URL } = setup();
  Piper.speak = async function* () {
    for (const s of ["s1", "s2", "s3", "s4"]) yield s;
  };
  send({ type: "commentarySpeak", text: "text", lang: "en" });
  await flush();
  // s1 plays, s2 and s3 queued: the reader waits.
  assert.equal(URL.createObjectURL.calls.length, 3);
  clock.tick(1000);
  await flush();
  assert.equal(URL.createObjectURL.calls.length, 3);

  commentary.dispatchEvent({ type: "ended" }); // s2 plays, queue shrinks
  clock.tick(200);
  await flush();
  assert.equal(URL.createObjectURL.calls.length, 4);
});

test("speech: a synthesis error is reported", async () => {
  const { send, Piper, sent, ctx } = setup();
  Piper.speak = async function* () { throw new Error("boom"); };
  send({ type: "commentarySpeak", text: "text", lang: "en" });
  await flush();
  assert.deepEqual(sent(), [{ type: "commentaryEnded", error: "Text-to-speech failed: boom" }]);
  assert.equal(ctx.console.warn.calls.length, 1);
});

test("speech: nothing to say ends the commentary", async () => {
  const { send, sent } = setup();
  send({ type: "commentarySpeak", text: "", lang: "en" });
  await flush();
  assert.deepEqual(sent(), [{ type: "commentaryEnded" }]);
});

test("speech: pause and resume continue with the same sentence", async () => {
  const { send, commentary, Piper } = setup();
  Piper.speak = async function* () {
    yield "s1";
    await new Promise(() => {}); // the next sentence is never ready
  };
  send({ type: "commentarySpeak", text: "text", lang: "en" });
  await flush();
  send({ type: "commentaryPause" });
  assert.equal(commentary.paused, true);
  assert.deepEqual(plain(send({ type: "commentaryResume" }).response), { ok: true });
  assert.equal(commentary.paused, false);
  assert.equal(commentary.src, "blob:1");
});

test("speech: pausing before the first sentence is ready delays playback until resume", async () => {
  const { send, commentary, Piper } = setup();
  let release;
  const gate = new Promise((r) => { release = r; });
  Piper.speak = async function* () {
    await gate;
    yield "s1";
    await new Promise(() => {});
  };
  send({ type: "commentarySpeak", text: "text", lang: "en" });
  send({ type: "commentaryPause" });
  release();
  await flush();
  assert.equal(commentary.playCalls, 0); // paused: the sentence waits in the queue

  assert.deepEqual(plain(send({ type: "commentaryResume" }).response), { ok: true });
  assert.equal(commentary.src, "blob:1");
  assert.equal(commentary.playCalls, 1);
});

test("starting a new commentary stops the previous one", async () => {
  const { send, commentary, Piper, URL } = setup();
  Piper.speak = async function* () {
    yield "s1";
    await new Promise(() => {});
  };
  send({ type: "commentarySpeak", text: "one", lang: "en" });
  await flush();
  send({ type: "commentaryPlay", url: "https://c/a.ogg" });
  assert.equal(commentary.src, "https://c/a.ogg");
  assert.deepEqual(URL.revokeObjectURL.calls[0], ["blob:1"]);
});

// --- Piper plumbing ---------------------------------------------------------------------

test("preload asks Piper for the voice and logs a failure", async () => {
  const { send, Piper, ctx } = setup();
  send({ type: "commentaryPreload", lang: "de" });
  assert.deepEqual(Piper.preload.calls[0], ["de"]);

  Piper.preload = spy(async () => { throw new Error("offline"); });
  send({ type: "commentaryPreload", lang: "en" });
  await flush();
  assert.equal(ctx.console.warn.calls.length, 1);
});

test("download progress from Piper is forwarded as a notice", () => {
  const { Piper, sent } = setup();
  Piper.onProgress("Downloading voice 50%…");
  assert.deepEqual(sent(), [{ type: "commentaryNotice", message: "Downloading voice 50%…" }]);
});
