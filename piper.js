// Piper neural text-to-speech (https://github.com/rhasspy/piper), run locally in
// the offscreen document, because Chrome's own speech has no voices in some
// Linux builds (e.g. the Chromium snap). espeak-ng turns text into phonemes
// (vendor/piper_phonemize.*), a voice model run with ONNX Runtime (vendor/ort*)
// turns those into audio. Voice models (~60 MB each) and espeak's data (~18 MB)
// are downloaded on first use and kept in the Cache API.
//
// "low" quality voices: on a 2012 dual-core laptop they synthesize at ~0.7×
// real time, the "medium" ones at ~1.15×, which would stutter.

const Piper = (() => {
  const VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/";
  const VOICES = {
    en: "en/en_US/lessac/low/en_US-lessac-low",
    de: "de/de_DE/thorsten/low/de_DE-thorsten-low",
  };
  const ESPEAK_DATA = "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data";
  const CACHE = "piper-v1";

  ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/");
  ort.env.wasm.numThreads = 1; // more threads don't help with these models

  let onProgress = () => {}; // (message) while downloading

  // Downloaded once, then served from the cache.
  async function cachedBuffer(url, label) {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${url}`);
    const total = +res.headers.get("Content-Length") || 0;
    const chunks = [];
    let loaded = 0, shown = -1;
    for (const reader = res.body.getReader(); ;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      // Content-Length is the compressed size when the server compresses.
      const pct = total && loaded <= total ? Math.floor((loaded / total) * 10) * 10 : -1;
      if (label && pct !== shown) {
        shown = pct;
        onProgress(`Downloading ${label}${pct >= 0 ? ` ${pct}%` : ""}…`);
      }
    }
    const blob = new Blob(chunks);
    await cache.put(url, new Response(blob));
    return blob.arrayBuffer();
  }

  const memo = (f) => {
    const m = new Map();
    return (key) => {
      if (!m.has(key)) {
        const p = f(key);
        p.catch(() => m.delete(key));
        m.set(key, p);
      }
      return m.get(key);
    };
  };

  const phonemizerFiles = memo(async () => {
    const [wasm, data] = await Promise.all([
      fetch(chrome.runtime.getURL("vendor/piper_phonemize.wasm")).then((r) => r.arrayBuffer()),
      cachedBuffer(ESPEAK_DATA, "pronunciation data"),
    ]);
    return { wasm, data };
  });

  const voice = memo(async (key) => {
    const [config, model] = await Promise.all([
      cachedBuffer(`${VOICE_BASE}${VOICES[key]}.onnx.json`).then((b) => JSON.parse(new TextDecoder().decode(b))),
      cachedBuffer(`${VOICE_BASE}${VOICES[key]}.onnx`, "voice"),
    ]);
    onProgress("Preparing voice…");
    return { config, session: await ort.InferenceSession.create(model) };
  });

  const voiceKey = (lang) => (VOICES[lang] ? lang : "en");

  // Phonemes per sentence. The phonemizer is a command-line program compiled
  // to WebAssembly, so each call runs a fresh instance; it prints one line per
  // input entry.
  async function phonemize(sentences, espeakVoice) {
    const { wasm, data } = await phonemizerFiles("");
    const lines = [];
    const mod = await createPiperPhonemize({
      wasmBinary: wasm,
      getPreloadedPackage: () => data.slice(0),
      locateFile: (f) => f,
      print: (line) => lines.push(line),
      printErr: () => {},
    });
    mod.callMain([
      "-l", espeakVoice,
      "--input", JSON.stringify(sentences.map((text) => ({ text }))),
      "--espeak_data", "/espeak-ng-data",
    ]);
    return lines.map((l) => JSON.parse(l).phonemes);
  }

  // As Piper does it: start, each phoneme followed by padding, end. The ids
  // come from the voice's own table (the phonemizer's built-in one only fits
  // some voices).
  function phonemeIds(phonemes, map) {
    const ids = [...map["^"], ...map["_"]];
    for (const ph of phonemes) if (map[ph]) ids.push(...map[ph], ...map["_"]);
    ids.push(...map["$"]);
    return ids;
  }

  function wav(samples, rate) {
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
    str(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); str(36, "data"); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
    }
    return new Blob([view.buffer], { type: "audio/wav" });
  }

  async function synthesize(phonemes, { config, session }) {
    const ids = phonemeIds(phonemes, config.phoneme_id_map);
    const { noise_scale, length_scale, noise_w } = config.inference;
    const feeds = {
      input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor("float32", Float32Array.from([noise_scale, length_scale, noise_w]), [3]),
    };
    if (Object.keys(config.speaker_id_map || {}).length) {
      feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
    }
    const { output } = await session.run(feeds);
    return wav(output.data, config.audio.sample_rate);
  }

  // Yields one WAV blob per sentence, so playback can start after the first.
  async function* speak(text, lang) {
    const key = voiceKey(lang);
    const v = await voice(key);
    const sentences = [...new Intl.Segmenter(key, { granularity: "sentence" }).segment(text)]
      .map((s) => s.segment.trim())
      .filter(Boolean);
    for (const phonemes of await phonemize(sentences, v.config.espeak.voice)) {
      if (phonemes.length) yield await synthesize(phonemes, v);
    }
  }

  return {
    speak,
    preload: (lang) => voice(voiceKey(lang)).then(() => phonemizerFiles("")),
    set onProgress(f) { onProgress = f; },
  };
})();
