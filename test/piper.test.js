const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts, plain, spy, makeChrome, errorResponse } = require("./helpers/env");

const BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/";
const URLS = {
  wasm: "chrome-extension://ext-id/vendor/piper_phonemize.wasm",
  espeak: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data",
  enConfig: `${BASE}en/en_US/lessac/low/en_US-lessac-low.onnx.json`,
  enModel: `${BASE}en/en_US/lessac/low/en_US-lessac-low.onnx`,
  deConfig: `${BASE}de/de_DE/thorsten/low/de_DE-thorsten-low.onnx.json`,
  deModel: `${BASE}de/de_DE/thorsten/low/de_DE-thorsten-low.onnx`,
};

const CONFIG = {
  phoneme_id_map: { "^": [1], "_": [0], "$": [2], a: [3], b: [4] },
  inference: { noise_scale: 0.5, length_scale: 1, noise_w: 0.25 },
  audio: { sample_rate: 16000 },
  espeak: { voice: "en-us" },
  speaker_id_map: {},
};
const bytes = (...n) => Uint8Array.from(n);
const json = (o) => new TextEncoder().encode(JSON.stringify(o));

// A fetch response whose body arrives in `chunks` pieces.
function download(data, { chunks = 1, length = true } = {}) {
  const size = Math.ceil(data.length / chunks);
  const parts = Array.from({ length: chunks }, (_, i) => data.slice(i * size, (i + 1) * size));
  return {
    ok: true,
    status: 200,
    headers: { get: (h) => (h === "Content-Length" && length ? String(data.length) : null) },
    body: {
      getReader() {
        let i = 0;
        return { read: async () => (i < parts.length ? { done: false, value: parts[i++] } : { done: true }) };
      },
    },
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length),
  };
}

function setup({ files, store = new Map(), config = CONFIG, downloads = {} } = {}) {
  const served = files || {
    [URLS.wasm]: bytes(0, 97, 115, 109),
    [URLS.espeak]: bytes(1, 2, 3),
    [URLS.enConfig]: json(config), [URLS.enModel]: bytes(10, 11, 12, 13),
    [URLS.deConfig]: json(config), [URLS.deModel]: bytes(20, 21, 22, 23),
  };
  const chrome = makeChrome();
  const fetch = spy(async (url) => (served[url] ? download(served[url], downloads[url]) : errorResponse(404)));

  const caches = {
    open: async () => ({
      match: async (url) => (store.has(url) ? { arrayBuffer: async () => store.get(url) } : undefined),
      put: async (url, res) => { store.set(url, await res.arrayBuffer()); },
    }),
  };

  const sessions = [];
  const ort = {
    env: { wasm: {} },
    Tensor: class { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } },
    InferenceSession: {
      create: spy(async () => {
        const session = { run: spy(async () => ({ output: { data: Float32Array.from([0, 0.5, -1, 2]) } })) };
        sessions.push(session);
        return session;
      }),
    },
  };

  // Stands in for the espeak-ng WebAssembly program: one phoneme line per input entry.
  const phonemizer = { options: [], args: [] };
  const createPiperPhonemize = spy(async (options) => {
    phonemizer.options.push(options);
    return {
      callMain(args) {
        phonemizer.args.push(args);
        for (const { text } of JSON.parse(args[3])) {
          const phonemes = text.startsWith("silent") ? [] : text.includes("unknown") ? ["a", "zzz", "b"] : ["a", "b"];
          options.print(JSON.stringify({ phonemes }));
        }
      },
    };
  });

  const env = loadScripts(["piper.js"], { chrome, ort, caches, fetch, createPiperPhonemize });
  return { fetch, ort, sessions, phonemizer, store, Piper: env.ev("Piper"), ...env };
}

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}
const fetched = (env, url) => env.fetch.calls.filter((c) => c[0] === url).length;

test("points ONNX Runtime at the extension's vendor folder with one thread", () => {
  const { ort } = setup();
  assert.equal(ort.env.wasm.wasmPaths, "chrome-extension://ext-id/vendor/");
  assert.equal(ort.env.wasm.numThreads, 1);
});

test("speak yields one WAV per sentence", async () => {
  const { Piper } = setup();
  const blobs = await collect(Piper.speak("Hello world. Second one.", "en"));
  assert.equal(blobs.length, 2);
  for (const blob of blobs) {
    assert.equal(blob.type, "audio/wav");
    assert.equal(blob.size, 44 + 4 * 2);
  }
});

test("the WAV has a valid header and clamped 16-bit samples", async () => {
  const { Piper } = setup();
  const [blob] = await collect(Piper.speak("Hello.", "en"));
  const view = new DataView(await blob.arrayBuffer());
  const str = (o, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));
  assert.equal(str(0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), 36 + 8);
  assert.equal(str(8, 4), "WAVE");
  assert.equal(str(12, 4), "fmt ");
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 1); // mono
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(str(36, 4), "data");
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true)), [0, 16383, -32767, 32767]);
});

test("the phonemizer gets the sentences and the voice's espeak voice", async () => {
  const { Piper, phonemizer } = setup();
  await collect(Piper.speak("Hello world. Second one.", "en"));
  assert.equal(phonemizer.args.length, 1);
  const [flag, voice, input, sentences, data, dir] = phonemizer.args[0];
  assert.deepEqual([flag, voice, input, data, dir], ["-l", "en-us", "--input", "--espeak_data", "/espeak-ng-data"]);
  assert.deepEqual(JSON.parse(sentences), [{ text: "Hello world." }, { text: "Second one." }]);
});

test("the phonemizer is given the wasm binary and a copy of the espeak data", async () => {
  const { Piper, phonemizer } = setup();
  await collect(Piper.speak("Hello.", "en"));
  const options = phonemizer.options[0];
  assert.deepEqual(Array.from(new Uint8Array(options.wasmBinary)), [0, 97, 115, 109]);
  assert.deepEqual(Array.from(new Uint8Array(options.getPreloadedPackage())), [1, 2, 3]);
  assert.equal(options.locateFile("x.data"), "x.data");
});

test("the model gets the phoneme ids from the voice's table, with padding", async () => {
  const { Piper, sessions } = setup();
  await collect(Piper.speak("Hello.", "en"));
  const [feeds] = sessions[0].run.calls[0];
  assert.deepEqual(Array.from(feeds.input.data), [1n, 0n, 3n, 0n, 4n, 0n, 2n]);
  assert.deepEqual(plain(feeds.input.dims), [1, 7]);
  assert.equal(feeds.input.type, "int64");
  assert.deepEqual(Array.from(feeds.input_lengths.data), [7n]);
  assert.deepEqual(Array.from(feeds.scales.data), [0.5, 1, 0.25]);
  assert.equal("sid" in feeds, false);
});

test("phonemes missing from the voice's table are skipped", async () => {
  const { Piper, sessions } = setup();
  await collect(Piper.speak("An unknown one.", "en"));
  const [feeds] = sessions[0].run.calls[0];
  assert.deepEqual(Array.from(feeds.input.data), [1n, 0n, 3n, 0n, 4n, 0n, 2n]);
});

test("multi-speaker voices get speaker 0", async () => {
  const { Piper, sessions } = setup({ config: { ...CONFIG, speaker_id_map: { alice: 0, bob: 1 } } });
  await collect(Piper.speak("Hello.", "en"));
  const [feeds] = sessions[0].run.calls[0];
  assert.deepEqual(Array.from(feeds.sid.data), [0n]);
  assert.deepEqual(plain(feeds.sid.dims), [1]);
});

test("sentences without phonemes are skipped", async () => {
  const { Piper } = setup();
  const blobs = await collect(Piper.speak("Hello there. silent.", "en"));
  assert.equal(blobs.length, 1);
});

test("German uses the German voice, other languages fall back to English", async () => {
  const de = setup();
  await collect(de.Piper.speak("Hallo.", "de"));
  assert.equal(fetched(de, URLS.deModel), 1);
  assert.equal(fetched(de, URLS.enModel), 0);

  const fr = setup();
  await collect(fr.Piper.speak("Bonjour.", "fr"));
  assert.equal(fetched(fr, URLS.enModel), 1);
  assert.equal(fetched(fr, URLS.deModel), 0);
});

test("a voice is loaded once, however often it speaks", async () => {
  const env = setup();
  await collect(env.Piper.speak("One.", "en"));
  await collect(env.Piper.speak("Two.", "en"));
  assert.equal(fetched(env, URLS.enModel), 1);
  assert.equal(fetched(env, URLS.espeak), 1);
  assert.equal(env.ort.InferenceSession.create.calls.length, 1);
});

test("a failed download is reported and tried again next time", async () => {
  const files = {
    [URLS.wasm]: bytes(0), [URLS.espeak]: bytes(1), [URLS.enConfig]: json(CONFIG),
  };
  const env = setup({ files });
  await assert.rejects(collect(env.Piper.speak("Hello.", "en")), {
    message: `download failed: HTTP 404 ${URLS.enModel}`,
  });

  files[URLS.enModel] = bytes(10);
  const blobs = await collect(env.Piper.speak("Hello.", "en"));
  assert.equal(blobs.length, 1);
});

test("downloads are cached and served from the cache next time", async () => {
  const first = setup();
  await collect(first.Piper.speak("Hello.", "en"));
  assert.ok(first.store.has(URLS.enModel));
  assert.ok(first.store.has(URLS.espeak));

  const second = setup({ store: first.store });
  await collect(second.Piper.speak("Hello.", "en"));
  assert.equal(fetched(second, URLS.enModel), 0);
  assert.equal(fetched(second, URLS.enConfig), 0);
  assert.equal(fetched(second, URLS.espeak), 0);
  assert.equal(fetched(second, URLS.wasm), 1); // shipped with the extension, not cached
});

test("download progress is reported in steps of ten percent", async () => {
  const env = setup({ downloads: { [URLS.enModel]: { chunks: 2 } } });
  const progress = spy();
  env.Piper.onProgress = progress;
  await collect(env.Piper.speak("Hello.", "en"));
  const messages = progress.calls.map((c) => c[0]);
  assert.deepEqual(messages.filter((m) => m.includes("voice")), [
    "Downloading voice 50%…", "Downloading voice 100%…", "Preparing voice…",
  ]);
  assert.ok(messages.some((m) => m.startsWith("Downloading pronunciation data")));
});

test("download progress without a known size shows no percentage", async () => {
  const env = setup({ downloads: { [URLS.enModel]: { chunks: 2, length: false } } });
  const progress = spy();
  env.Piper.onProgress = progress;
  await collect(env.Piper.speak("Hello.", "en"));
  const messages = progress.calls.map((c) => c[0]);
  assert.equal(messages.some((m) => /voice.*%/.test(m)), false);
  assert.ok(messages.includes("Preparing voice…"));
});

test("preload fetches the voice and the pronunciation data without speaking", async () => {
  const env = setup();
  await env.Piper.preload("de");
  assert.equal(fetched(env, URLS.deModel), 1);
  assert.equal(fetched(env, URLS.espeak), 1);
  assert.equal(fetched(env, URLS.wasm), 1);
  assert.equal(env.phonemizer.args.length, 0);

  await collect(env.Piper.speak("Hallo.", "de"));
  assert.equal(fetched(env, URLS.deModel), 1);
});
