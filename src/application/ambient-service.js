// Plays the field recording made closest to the position, crossfading when a
// different one becomes the nearest.

import { nearestLocation } from "../domain/recordings.js";
import { OffscreenMsg } from "../shared/messages.js";
import { StorageKey } from "../shared/storage-keys.js";

export class AmbientService {
  /**
   * @param {{ recordings: import("../ports/index.js").RecordingRepository, audio: import("../ports/index.js").OffscreenAudio,
   *           soundEnabled: () => Promise<boolean>, session: chrome.storage.StorageArea,
   *           random: () => number, warn: (...a: any[]) => void }} deps
   */
  constructor({ recordings, audio, soundEnabled, session, random, warn }) {
    this.recordings = recordings;
    this.audio = audio;
    this.soundEnabled = soundEnabled;
    this.session = session;
    this.random = random;
    this.warn = warn;
    /** What is playing (or paused) and for which tab. In memory: if the worker
     * restarts, the next position update from the page starts over.
     * @type {{ tabId: number, locid: number, sound: any } | null} */
    this.current = null;
    this.seq = 0;
  }

  /** @param {number} tabId @param {import("../domain/geo.js").GeoPoint} point */
  async at(tabId, point) {
    const seq = ++this.seq;
    if (!(await this.soundEnabled())) return;
    try {
      const { loc, km } = nearestLocation(await this.recordings.locations(), point);
      if (!loc || seq !== this.seq) return;
      if (this.current?.locid === loc[0]) {
        this.current.tabId = tabId;
        await this.audio.send({ type: OffscreenMsg.PLAY, url: this.current.sound.mp3 });
        return;
      }
      const sounds = await this.recordings.playlist(loc[0]);
      if (seq !== this.seq || !sounds.length) return;
      const sound = sounds[Math.floor(this.random() * sounds.length)];
      this.current = { tabId, locid: loc[0], sound };
      await this.audio.send({ type: OffscreenMsg.PLAY, url: sound.mp3 });
      await this.session.set({
        [StorageKey.NOW_PLAYING]: {
          title: sound.ctitle,
          place: sound.ltitle,
          artist: sound.artist,
          licence: sound.licence,
          recdate: sound.recdate,
          km: Math.round(km * 10) / 10,
          link: `https://aporee.org/maps/?loc=${loc[0]}`,
        },
      });
    } catch (err) {
      this.warn("ambient sound:", err);
    }
  }

  /** Pause, if `tabId` (or any tab, without one) is the one playing. @param {number} [tabId] */
  async stop(tabId) {
    if (!this.current || (tabId !== undefined && this.current.tabId !== tabId)) return;
    this.seq++;
    await this.audio.send({ type: OffscreenMsg.PAUSE });
  }

  async applyVolumes() {
    if (await this.audio.isOpen()) await this.audio.send({ type: OffscreenMsg.VOLUME });
  }
}
