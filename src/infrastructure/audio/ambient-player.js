// The ambient recording. Two <audio> elements crossfade between recordings;
// the sound is lowered (ducked) while the commentary plays.

import { DUCK, FADE_MS, FADE_STEP } from "../../shared/config.js";

export class AmbientPlayer {
  /**
   * @param {[HTMLAudioElement, HTMLAudioElement]} players
   * @param {{ setInterval: typeof setInterval, clearInterval: typeof clearInterval, now: () => number }} timers
   */
  constructor(players, timers) {
    this.players = players;
    this.timers = timers;
    this.active = 0;
    this.volume = 0.5;
    this.ducked = false;
    /** @type {Map<HTMLAudioElement, any>} audio element -> fade interval */
    this.fades = new Map();
  }

  get effectiveVolume() {
    return this.volume * (this.ducked ? DUCK : 1);
  }

  /** @param {HTMLAudioElement} audio @param {number} to @param {() => void} [then] */
  fade(audio, to, then) {
    this.timers.clearInterval(this.fades.get(audio));
    const from = audio.volume;
    const start = this.timers.now();
    this.fades.set(
      audio,
      this.timers.setInterval(() => {
        const t = Math.min((this.timers.now() - start) / FADE_MS, 1);
        audio.volume = from + (to - from) * t;
        if (t === 1) {
          this.timers.clearInterval(this.fades.get(audio));
          this.fades.delete(audio);
          then?.();
        }
      }, FADE_STEP),
    );
  }

  /** @param {string} url */
  play(url) {
    const cur = this.players[this.active];
    if (cur.src === url) {
      // Same recording: resume where it was paused.
      if (cur.paused) cur.play().catch(() => {});
      this.fade(cur, this.effectiveVolume);
      return;
    }
    this.fade(cur, 0, () => cur.pause());
    this.active = 1 - this.active;
    const next = this.players[this.active];
    next.src = url;
    next.volume = 0;
    next.play().catch((err) => console.warn("ambient play failed:", err));
    this.fade(next, this.effectiveVolume);
  }

  pause() {
    for (const p of this.players) this.fade(p, 0, () => p.pause());
  }

  /** Fade the playing recording to the current volume. */
  applyVolume() {
    const cur = this.players[this.active];
    if (!cur.paused) this.fade(cur, this.effectiveVolume);
  }

  /** @param {boolean} on */
  duck(on) {
    this.ducked = on;
    this.applyVolume();
  }

  status() {
    const p = this.players[this.active];
    return { src: p.src, paused: p.paused, currentTime: p.currentTime, volume: p.volume };
  }
}
