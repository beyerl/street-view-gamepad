// Composition root of the offscreen document, which plays all audio: the
// page itself may not autoplay (gamepad input is no user gesture).

import { Msg, OffscreenMsg } from "../shared/messages.js";
import { AmbientPlayer } from "../infrastructure/audio/ambient-player.js";
import { CommentaryPlayer } from "../infrastructure/audio/commentary-player.js";
import { PiperSynthesizer } from "../infrastructure/audio/piper-synthesizer.js";

/** @param {any} g the document's global object (a stand-in in tests) */
export function startOffscreen(g) {
  const { document, chrome } = g;
  const notify = (/** @type {object} */ msg) => chrome.runtime.sendMessage(msg).catch(() => {});
  const ambient = new AmbientPlayer([document.getElementById("a"), document.getElementById("b")], {
    setInterval: g.setInterval.bind(g),
    clearInterval: g.clearInterval.bind(g),
    now: () => g.performance.now(),
  });
  const synthesizer = new PiperSynthesizer({
    ort: g.ort,
    createPhonemizer: g.createPiperPhonemize,
    fetch: (/** @type {any[]} */ ...a) => g.fetch(...a),
    caches: g.caches,
    getURL: (/** @type {string} */ p) => chrome.runtime.getURL(p),
    Blob: g.Blob,
    Response: g.Response,
    Segmenter: g.Intl.Segmenter,
  });
  const onNotice = (/** @type {string} */ message) => notify({ type: Msg.COMMENTARY_NOTICE, message });
  synthesizer.onProgress = onNotice;
  const commentary = new CommentaryPlayer({
    audio: document.getElementById("c"),
    synthesizer,
    ambient,
    URL: g.URL,
    sleep: (ms) => new Promise((r) => g.setTimeout(r, ms)),
    onEnded: (error) => notify({ type: Msg.COMMENTARY_ENDED, error }),
    onNotice,
    warn: (...a) => g.console.warn(...a),
  });

  /** @type {Record<string, (msg: any, respond: (r: any) => void) => void>} */
  const handlers = {
    [OffscreenMsg.STATUS]: (_m, respond) => respond(ambient.status()),
    [OffscreenMsg.PLAY]: (m) => ambient.play(m.url),
    [OffscreenMsg.PAUSE]: () => ambient.pause(),
    [OffscreenMsg.VOLUME]: () => ambient.applyVolume(),
    [OffscreenMsg.COMMENTARY_PLAY]: (m) => commentary.playRecording(m.url),
    [OffscreenMsg.COMMENTARY_SPEAK]: (m) => commentary.speak(m.text, m.lang),
    [OffscreenMsg.COMMENTARY_PRELOAD]: (m) =>
      synthesizer.preload(m.lang).catch((err) => g.console.warn("preload:", err)),
    [OffscreenMsg.COMMENTARY_PAUSE]: () => commentary.pause(),
    [OffscreenMsg.COMMENTARY_RESUME]: (_m, respond) => respond({ ok: commentary.resume() }),
    [OffscreenMsg.COMMENTARY_STOP]: () => commentary.stop(),
  };

  chrome.runtime.onMessage.addListener(
    (/** @type {any} */ msg, /** @type {any} */ _sender, /** @type {(r: any) => void} */ sendResponse) => {
      if (msg?.target !== OffscreenMsg.TARGET) return;
      if (msg.type !== OffscreenMsg.STATUS) {
        if (typeof msg.volume === "number") ambient.volume = msg.volume;
        if (typeof msg.commentaryVolume === "number") commentary.volume = msg.commentaryVolume;
      }
      handlers[msg.type]?.(msg, sendResponse);
    },
  );

  return { ambient, commentary, synthesizer };
}
