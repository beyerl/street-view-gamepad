// The commentary: either a Spoken Wikipedia recording (one URL), or an
// article read aloud, synthesized sentence by sentence a little ahead of
// playback.

import { READ_AHEAD, READ_AHEAD_WAIT } from "../../shared/config.js";

/** @typedef {{ queue: string[], done: boolean, playing: boolean, waiting: boolean }} Speech */

export class CommentaryPlayer {
  /**
   * @param {{ audio: HTMLAudioElement, synthesizer: import("../../ports/index.js").SpeechSynthesizer,
   *           ambient: { duck(on: boolean): void }, URL: { createObjectURL(b: Blob): string, revokeObjectURL(u: string): void },
   *           sleep: (ms: number) => Promise<void>, onEnded: (error?: string) => void, onNotice: (message: string) => void,
   *           warn: (...a: any[]) => void }} deps
   */
  constructor({ audio, synthesizer, ambient, URL, sleep, onEnded, onNotice, warn }) {
    this.audio = audio;
    this.synthesizer = synthesizer;
    this.ambient = ambient;
    this.URL = URL;
    this.sleep = sleep;
    this.onEnded = onEnded;
    this.onNotice = onNotice;
    this.warn = warn;
    /** @type {Speech | null} */
    this.speech = null;
    audio.addEventListener("ended", () => {
      if (this.speech) this.nextSentence(this.speech);
      else this.finish();
    });
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
  }

  revokeCurrent() {
    if (this.audio.src.startsWith("blob:")) this.URL.revokeObjectURL(this.audio.src);
  }

  startPlayback() {
    this.audio.play().catch((err) => {
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
      return;
    }
    if (s.waiting) this.onNotice(""); // clear "Downloading…"
    s.waiting = false;
    this.audio.src = url;
    this.startPlayback();
  }

  pause() {
    if (this.speech) this.speech.playing = false;
    this.audio.pause();
    this.ambient.duck(false);
  }

  /** False if there is nothing to resume (e.g. this document was recreated). */
  resume() {
    const s = this.speech;
    if (s) {
      s.playing = true;
      this.ambient.duck(true);
      if (!s.waiting) this.startPlayback();
      else if (s.queue.length) this.nextSentence(s);
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
