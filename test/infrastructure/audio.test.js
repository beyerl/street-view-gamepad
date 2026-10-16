import { test } from "node:test";
import assert from "node:assert/strict";
import { AmbientPlayer } from "../../src/infrastructure/audio/ambient-player.js";
import { CommentaryPlayer } from "../../src/infrastructure/audio/commentary-player.js";
import {
  ESPEAK_DATA,
  phonemeIds,
  PiperSynthesizer,
  VOICE_BASE,
  VOICES,
  wavBytes,
} from "../../src/infrastructure/audio/piper-synthesizer.js";
import { flush, makeClock, spy } from "../helpers/fakes.js";

class FakeAudio {
  constructor() {
    this.src = "";
    this.volume = 1;
    this.paused = true;
    this.currentTime = 0;
    this.playError = null;
    this.listeners = {};
    this.loads = 0;
  }
  play() {
    if (this.playError) return Promise.reject(this.playError);
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {
    this.loads++;
  }
  removeAttribute(k) {
    if (k === "src") this.src = "";
  }
  addEventListener(t, f) {
    (this.listeners[t] ||= []).push(f);
  }
  emit(t) {
    for (const f of this.listeners[t] || []) f();
  }
}

function ambientSetup() {
  const clock = makeClock();
  const a = new FakeAudio();
  const b = new FakeAudio();
  return { clock, a, b, player: new AmbientPlayer([a, b], clock) };
}

test("ambient: crossfades to a new recording", () => {
  const { clock, a, b, player } = ambientSetup();
  player.play("https://x/1.mp3");
  assert.equal(b.src, "https://x/1.mp3");
  assert.equal(b.volume, 0);
  clock.tick(750);
  assert.ok(Math.abs(b.volume - 0.25) < 0.02);
  clock.tick(800);
  assert.equal(b.volume, 0.5);
  player.play("https://x/2.mp3");
  clock.tick(1600);
  assert.deepEqual([a.src, a.paused, a.volume, b.paused, b.volume], ["https://x/2.mp3", false, 0.5, true, 0]);
  assert.equal(clock.pending(), 0);
});

test("ambient: the same recording resumes; pause fades both out; volume and ducking", () => {
  const { clock, b, player } = ambientSetup();
  player.play("u");
  clock.tick(2000);
  player.pause();
  clock.tick(2000);
  assert.equal(b.paused, true);
  player.play("u");
  clock.tick(2000);
  assert.deepEqual([b.paused, b.volume], [false, 0.5]);
  player.volume = 0.8;
  player.applyVolume();
  clock.tick(2000);
  assert.equal(b.volume, 0.8);
  player.duck(true);
  clock.tick(2000);
  assert.ok(Math.abs(b.volume - 0.2) < 1e-9);
  assert.deepEqual(player.status(), { src: "u", paused: false, currentTime: 0, volume: b.volume });
});

function commentarySetup({ sentences = ["s1", "s2", "s3"], fail } = {}) {
  const audio = new FakeAudio();
  const ambient = { duck: spy() };
  let n = 0;
  const URL = { createObjectURL: () => `blob:${++n}`, revokeObjectURL: spy() };
  const synthesizer = {
    async *speak() {
      for (const s of sentences) {
        await Promise.resolve();
        if (fail) throw new Error(fail);
        yield s;
      }
    },
  };
  const onEnded = spy();
  const onNotice = spy();
  const warn = spy();
  const player = new CommentaryPlayer({
    audio,
    synthesizer,
    ambient,
    URL,
    sleep: () => flush(1),
    onEnded,
    onNotice,
    warn,
  });
  return { audio, ambient, URL, player, onEnded, onNotice, warn };
}

test("commentary: a recording plays with the ambient sound ducked, and ends", async () => {
  const env = commentarySetup();
  env.player.playRecording("https://c/a.ogg");
  assert.deepEqual(
    [env.audio.src, env.audio.paused, env.ambient.duck.calls.at(-1)],
    ["https://c/a.ogg", false, [true]],
  );
  env.audio.emit("ended");
  assert.deepEqual(env.onEnded.calls, [[undefined]]);
  assert.equal(env.audio.src, "");
  assert.deepEqual(env.ambient.duck.calls.at(-1), [false]);
});

test("commentary: speech plays sentence after sentence, clearing the download notice, and ends", async () => {
  const env = commentarySetup();
  const done = env.player.speak("text", "en");
  await flush();
  assert.equal(env.audio.src, "blob:1");
  assert.deepEqual(env.onNotice.calls, [[""]]);
  env.audio.emit("ended");
  assert.equal(env.audio.src, "blob:2");
  env.audio.emit("ended");
  await done;
  env.audio.emit("ended");
  assert.equal(env.onEnded.calls.length, 1);
  assert.ok(env.URL.revokeObjectURL.calls.length >= 3);
});

test("commentary: pause and resume, also while waiting for a sentence; nothing to resume after a restart", async () => {
  const env = commentarySetup();
  assert.equal(env.player.resume(), false);
  env.player.speak("text", "en");
  await flush();
  env.player.pause();
  assert.equal(env.audio.paused, true);
  assert.equal(env.player.resume(), true);
  assert.equal(env.audio.paused, false);
  env.player.playRecording("r");
  env.player.pause();
  assert.equal(env.player.resume(), true);
  env.player.volume = 0.3;
  assert.equal(env.audio.volume, 0.3);
});

test("commentary: synthesis and playback errors end it with a message", async () => {
  const tts = commentarySetup({ fail: "no voice" });
  await tts.player.speak("t", "en");
  assert.deepEqual(tts.onEnded.calls, [["Text-to-speech failed: no voice"]]);
  const play = commentarySetup();
  play.audio.playError = new Error("blocked");
  play.player.playRecording("r");
  await flush();
  assert.deepEqual(play.onEnded.calls, [["Commentary could not be played: blocked"]]);
});

test("commentary: a new commentary stops the old speech", async () => {
  const env = commentarySetup();
  const first = env.player.speak("one", "en");
  env.player.playRecording("r");
  await first;
  assert.equal(env.audio.src, "r");
});

// --- Piper ---------------------------------------------------------------------------

test("phoneme ids: start, each phoneme padded, end; unknown phonemes skipped", () => {
  const map = { "^": [1], _: [0], $: [2], a: [5], b: [6] };
  assert.deepEqual(phonemeIds(["a", "x", "b"], map), [1, 0, 5, 0, 6, 0, 2]);
});

test("wav: a 16-bit mono header and clipped samples", () => {
  const view = new DataView(wavBytes([0, 1, -2], 16000));
  const str = (o, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));
  assert.deepEqual([str(0, 4), str(8, 4), str(36, 4)], ["RIFF", "WAVE", "data"]);
  assert.deepEqual([view.getUint32(24, true), view.getUint16(22, true), view.getUint32(40, true)], [16000, 1, 6]);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)], [0, 32767, -32767]);
});

function piperSetup({ cached = {}, status = 200 } = {}) {
  const store = new Map(Object.entries(cached));
  const caches = {
    open: async () => ({
      match: async (url) => (store.has(url) ? new Response(store.get(url)) : undefined),
      put: async (url, res) => store.set(url, new Uint8Array(await res.arrayBuffer())),
    }),
  };
  const config = {
    phoneme_id_map: { "^": [1], _: [0], $: [2], a: [5] },
    inference: { noise_scale: 1, length_scale: 1, noise_w: 1 },
    espeak: { voice: "en-us" },
    audio: { sample_rate: 16000 },
    speaker_id_map: {},
  };
  const files = {
    [`${VOICE_BASE}${VOICES.en}.onnx.json`]: JSON.stringify(config),
    [`${VOICE_BASE}${VOICES.en}.onnx`]: "model",
    [ESPEAK_DATA]: "data",
  };
  const fetch = spy(async (url) => {
    if (url.endsWith("piper_phonemize.wasm")) return new Response("wasm");
    if (status !== 200) return new Response("", { status });
    return new Response(files[url], { headers: { "Content-Length": String(files[url].length) } });
  });
  const runs = [];
  const ort = {
    env: { wasm: {} },
    Tensor: class {
      constructor(type, data, dims) {
        Object.assign(this, { type, data, dims });
      }
    },
    InferenceSession: {
      create: async () => ({ run: async (feeds) => (runs.push(feeds), { output: { data: [0, 0.5] } }) }),
    },
  };
  const createPhonemizer = async (opts) => ({
    callMain: (args) => {
      const input = JSON.parse(args[args.indexOf("--input") + 1]);
      for (const _ of input) opts.print(JSON.stringify({ phonemes: ["a"] }));
    },
  });
  const piper = new PiperSynthesizer({
    ort,
    createPhonemizer,
    fetch,
    caches,
    getURL: (p) => `ext://${p}`,
    Blob,
    Response,
    Segmenter: Intl.Segmenter,
  });
  const progress = [];
  piper.onProgress = (m) => progress.push(m);
  return { piper, fetch, ort, runs, progress, store };
}

test("piper: points ONNX Runtime at the bundled wasm, one thread", () => {
  const { ort } = piperSetup();
  assert.deepEqual(ort.env.wasm, { wasmPaths: "ext://vendor/", numThreads: 1 });
});

test("piper: speaks one WAV per sentence, downloading voice and data once with progress", async () => {
  const env = piperSetup();
  const blobs = [];
  for await (const b of env.piper.speak("One. Two.", "fr")) blobs.push(b); // unknown language: English voice
  assert.equal(blobs.length, 2);
  assert.equal(blobs[0].type, "audio/wav");
  assert.deepEqual([...env.runs[0].input.data].map(Number), [1, 0, 5, 0, 2]);
  assert.ok(env.progress.includes("Downloading voice 100%…"));
  assert.ok(env.progress.includes("Preparing voice…"));
  const fetched = env.fetch.calls.length;
  for await (const _ of env.piper.speak("Three.", "en"));
  await env.piper.preload("en");
  assert.equal(env.fetch.calls.length, fetched);
  assert.equal(env.store.size, 3); // all three downloads in the cache
});

test("piper: served from the cache without downloading; failed downloads are retried", async () => {
  const cachedEnv = piperSetup();
  for await (const _ of cachedEnv.piper.speak("x.", "en"));
  const again = piperSetup({ cached: Object.fromEntries(cachedEnv.store) });
  await again.piper.preload("en");
  assert.deepEqual(
    again.fetch.calls.map((c) => c[0]),
    ["ext://vendor/piper_phonemize.wasm"],
  );

  const failing = piperSetup({ status: 404 });
  await assert.rejects(failing.piper.preload("en"), /download failed: HTTP 404/);
  await assert.rejects(failing.piper.preload("en"), /HTTP 404/);
  assert.ok(failing.fetch.calls.length >= 4); // not memoized
});
