// Piper neural text-to-speech (https://github.com/rhasspy/piper), run locally
// in the offscreen document, because Chrome's own speech has no voices in
// some Linux builds (e.g. the Chromium snap). espeak-ng turns text into
// phonemes (vendor/piper_phonemize.*), a voice model run with ONNX Runtime
// (vendor/ort*) turns those into audio. Voice models (~60 MB each) and
// espeak's data (~18 MB) are downloaded on first use and kept in the Cache API.
//
// "low" quality voices: on a 2012 dual-core laptop they synthesize at ~0.7×
// real time, the "medium" ones at ~1.15×, which would stutter.

import { SpeechSynthesizer } from "../../ports/index.js";

export const VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/";
export const VOICES = Object.freeze({
  en: "en/en_US/lessac/low/en_US-lessac-low",
  de: "de/de_DE/thorsten/low/de_DE-thorsten-low",
});
export const ESPEAK_DATA = "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data";
const CACHE = "piper-v1";

/** As Piper does it: start, each phoneme followed by padding, end. The ids
 * come from the voice's own table (the phonemizer's built-in one only fits
 * some voices). @param {string[]} phonemes @param {Record<string, number[]>} map */
export function phonemeIds(phonemes, map) {
  const ids = [...map["^"], ...map["_"]];
  for (const ph of phonemes) if (map[ph]) ids.push(...map[ph], ...map["_"]);
  ids.push(...map["$"]);
  return ids;
}

/** 16-bit mono PCM WAV. @param {ArrayLike<number>} samples @param {number} rate */
export function wavBytes(samples, rate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (/** @type {number} */ o, /** @type {string} */ s) =>
    [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return view.buffer;
}

/** Calls f once per key, forgetting failures so they are retried. @template T @param {(key: string) => Promise<T>} f */
function memo(f) {
  /** @type {Map<string, Promise<T>>} */
  const m = new Map();
  return (/** @type {string} */ key) => {
    if (!m.has(key)) {
      const p = f(key);
      p.catch(() => m.delete(key));
      m.set(key, p);
    }
    return m.get(key);
  };
}

/** @implements {SpeechSynthesizer} */
export class PiperSynthesizer extends SpeechSynthesizer {
  /**
   * @param {{ ort: any, createPhonemizer: (opts: object) => Promise<any>, fetch: typeof globalThis.fetch, caches: CacheStorage,
   *           getURL: (path: string) => string, Blob: typeof globalThis.Blob, Response: typeof globalThis.Response,
   *           Segmenter: typeof Intl.Segmenter }} deps
   */
  constructor({ ort, createPhonemizer, fetch, caches, getURL, Blob, Response, Segmenter }) {
    super();
    this.ort = ort;
    this.createPhonemizer = createPhonemizer;
    this.fetch = fetch;
    this.caches = caches;
    this.getURL = getURL;
    this.Blob = Blob;
    this.Response = Response;
    this.Segmenter = Segmenter;
    ort.env.wasm.wasmPaths = getURL("vendor/");
    ort.env.wasm.numThreads = 1; // more threads don't help with these models
    /** @type {(message: string) => void} while downloading */
    this.onProgress = () => {};
    this.phonemizerFiles = memo(async () => {
      const [wasm, data] = await Promise.all([
        this.fetch(this.getURL("vendor/piper_phonemize.wasm")).then((r) => r.arrayBuffer()),
        this.cachedBuffer(ESPEAK_DATA, "pronunciation data"),
      ]);
      return { wasm, data };
    });
    this.voice = memo(async (key) => {
      const path = `${VOICE_BASE}${VOICES[/** @type {keyof typeof VOICES} */ (key)]}`;
      const [config, model] = await Promise.all([
        this.cachedBuffer(`${path}.onnx.json`).then((b) => JSON.parse(new TextDecoder().decode(b))),
        this.cachedBuffer(`${path}.onnx`, "voice"),
      ]);
      this.onProgress("Preparing voice…");
      return { config, session: await this.ort.InferenceSession.create(model) };
    });
  }

  /** Downloaded once, then served from the cache. @param {string} url @param {string} [label] for progress messages */
  async cachedBuffer(url, label) {
    const cache = await this.caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
    const res = await this.fetch(url);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${url}`);
    const total = +res.headers.get("Content-Length") || 0;
    const chunks = [];
    let loaded = 0;
    let shown = -1;
    for (const reader = res.body.getReader(); ;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      // Content-Length is the compressed size when the server compresses.
      const pct = total && loaded <= total ? Math.floor((loaded / total) * 10) * 10 : -1;
      if (label && pct !== shown) {
        shown = pct;
        this.onProgress(`Downloading ${label}${pct >= 0 ? ` ${pct}%` : ""}…`);
      }
    }
    const blob = new this.Blob(chunks);
    await cache.put(url, new this.Response(blob));
    return blob.arrayBuffer();
  }

  /** @param {string} lang */
  voiceKey(lang) {
    return lang in VOICES ? lang : "en";
  }

  /** Phonemes per sentence. The phonemizer is a command-line program compiled
   * to WebAssembly, so each call runs a fresh instance; it prints one line per
   * input entry. @param {string[]} sentences @param {string} espeakVoice */
  async phonemize(sentences, espeakVoice) {
    const { wasm, data } = await this.phonemizerFiles("");
    /** @type {string[]} */
    const lines = [];
    const mod = await this.createPhonemizer({
      wasmBinary: wasm,
      getPreloadedPackage: () => data.slice(0),
      locateFile: (/** @type {string} */ f) => f,
      print: (/** @type {string} */ line) => lines.push(line),
      printErr: () => {},
    });
    mod.callMain([
      "-l",
      espeakVoice,
      "--input",
      JSON.stringify(sentences.map((text) => ({ text }))),
      "--espeak_data",
      "/espeak-ng-data",
    ]);
    return lines.map((l) => JSON.parse(l).phonemes);
  }

  /** @param {string[]} phonemes @param {{ config: any, session: any }} voice */
  async synthesize(phonemes, { config, session }) {
    const { Tensor } = this.ort;
    const ids = phonemeIds(phonemes, config.phoneme_id_map);
    const { noise_scale, length_scale, noise_w } = config.inference;
    /** @type {Record<string, any>} */
    const feeds = {
      input: new Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new Tensor("float32", Float32Array.from([noise_scale, length_scale, noise_w]), [3]),
    };
    if (Object.keys(config.speaker_id_map || {}).length) feeds.sid = new Tensor("int64", BigInt64Array.from([0n]), [1]);
    const { output } = await session.run(feeds);
    return new this.Blob([wavBytes(output.data, config.audio.sample_rate)], { type: "audio/wav" });
  }

  /** One WAV blob per sentence, so playback can start after the first. @param {string} text @param {string} lang */
  async *speak(text, lang) {
    const key = this.voiceKey(lang);
    const v = await this.voice(key);
    const sentences = [...new this.Segmenter(key, { granularity: "sentence" }).segment(text)]
      .map((s) => s.segment.trim())
      .filter(Boolean);
    for (const phonemes of await this.phonemize(sentences, v.config.espeak.voice)) {
      if (phonemes.length) yield await this.synthesize(phonemes, v);
    }
  }

  async preload(/** @type {string} */ lang) {
    await this.voice(this.voiceKey(lang));
    await this.phonemizerFiles("");
  }
}
