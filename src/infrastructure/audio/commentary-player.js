// The commentary: either a Spoken Wikipedia recording (one URL), or an
// article read aloud, synthesized sentence by sentence a little ahead of
// playback. Reports whether it is loading: asked to play, but not playing
// yet (downloading, synthesizing, buffering).

import { READ_AHEAD, READ_AHEAD_WAIT } from "../../shared/config.js";

/** @typedef {{ queue: string[], done: boolean, playing: boolean, waiting: boolean }} Speech */

export class CommentaryPlayer {
  /**
   * @param {{ audio: HTMLAudioElement, synthesizer: import("../../ports/index.js").SpeechSynthesizer,
   *           ambient: { duck(on: boolean): void }, URL: { createObjectURL(b: Blob): string, revokeObjectURL(u: string): void },
   *           sleep: (ms: number) => Promise<void>, onEnded: (error?: string) => void, onNotice: (message: string) => void,
   *           onLoading?: (loading: boolean) => void, warn: (...a: any[]) => void }} deps
   */
  constructor({ audio, synthesizer, ambient, URL, sleep, onEnded, onNotice, onLoading = () => {}, warn }) {
    this.audio = audio;
    this.synthesizer = synthesizer;
    this.ambient = ambient;
    this.URL = URL;
    this.sleep = sleep;
    this.onEnded = onEnded;
    this.onNotice = onNotice;
    this.onLoading = onLoading;
    this.warn = warn;
    /** @type {Speech | null} */
    this.speech = null;
    this.loading = false;
    audio.addEventListener("ended", () => {
      if (this.speech) this.nextSentence(this.speech);
      else this.finish();
    });
    audio.addEventListener("playing", () => this.setLoading(false));
    audio.addEventListener("waiting", () => this.setLoading(true));
  }

  /** @param {boolean} loading */
  setLoading(loading) {
    if (loading === this.loading) return;
    this.loading = loading;
    this.onLoading(loading);
  }

  /** @param {string} [error] */
  finish(error) {
    this.stop();
    this.onEnded(error);
  }

  stop() {
    if (this.speech) this.speech.queue.forEach((u) => this.URL.revokeObjectURL(u));
    this.speech = null;
    this.audio.pause();
    this.revokeCurrent();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.ambient.duck(false);
    this.setLoading(false);
  }

  revokeCurrent() {
    if (this.audio.src.startsWith("blob:")) this.URL.revokeObjectURL(this.audio.src);
  }

  /** @param {boolean} [loading] whether to show it loading until "playing";
   * not between sentences, which would flicker */
  startPlayback(loading = true) {
    if (loading) this.setLoading(true);
    this.audio.play().catch((err) => {
      // A newer src or a pause interrupted this play(): not a failure, and
      // finishing here would stop what replaced it.
      if (err?.name === "AbortError") return;
      this.warn("commentary play failed:", err);
      this.finish(`Commentary could not be played: ${err.message}`);
    });
    this.ambient.duck(true);
  }

  /** @param {string} url */
  playRecording(url) {
    this.stop();
    this.audio.src = url;
    this.startPlayback();
  }

  /** @param {string} text @param {string} lang */
  async speak(text, lang) {
    this.stop();
    /** @type {Speech} */
    const s = (this.speech = { queue: [], done: false, playing: true, waiting: true });
    this.ambient.duck(true);
    this.setLoading(true);
    try {
      for await (const blob of this.synthesizer.speak(text, lang)) {
        if (this.speech !== s) return;
        s.queue.push(this.URL.createObjectURL(blob));
        if (s.waiting && s.playing) this.nextSentence(s);
        while (s.queue.length >= READ_AHEAD && this.speech === s) await this.sleep(READ_AHEAD_WAIT);
      }
      s.done = true;
      if (s.waiting && this.speech === s) this.finish();
    } catch (err) {
      this.warn("text-to-speech failed:", err);
      if (this.speech === s) this.finish(`Text-to-speech failed: ${err.message}`);
    }
  }

  /** @param {Speech} s */
  nextSentence(s) {
    const url = s.queue.shift();
    this.revokeCurrent();
    if (!url) {
      s.waiting = true;
      if (s.done) this.finish();
      else this.setLoading(s.playing); // the next sentence isn't synthesized yet
      return;
    }
    if (s.waiting) this.onNotice(""); // clear "Downloading…"
    s.waiting = false;
    this.audio.src = url;
    this.startPlayback(false);
  }

  pause() {
    if (this.speech) this.speech.playing = false;
    this.audio.pause();
    this.ambient.duck(false);
    this.setLoading(false);
  }

  /** False if there is nothing to resume (e.g. this document was recreated). */
  resume() {
    const s = this.speech;
    if (s) {
      s.playing = true;
      this.ambient.duck(true);
      if (!s.waiting) this.startPlayback();
      else if (s.queue.length) this.nextSentence(s);
      else this.setLoading(true);
      return true;
    }
    if (!this.audio.src) return false;
    this.startPlayback();
    return true;
  }

  /** @param {number} v */
  set volume(v) {
    this.audio.volume = v;
  }
}
