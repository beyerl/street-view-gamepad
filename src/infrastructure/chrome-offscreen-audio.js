// The background worker's handle on the offscreen document, which plays all
// audio (a page may not autoplay, and gamepad input is no user gesture).

import { OffscreenMsg } from "../shared/messages.js";
import { OffscreenAudio } from "../ports/index.js";

const CONTEXT = "OFFSCREEN_DOCUMENT";

/** @implements {OffscreenAudio} */
export class ChromeOffscreenAudio extends OffscreenAudio {
  /** @param {typeof globalThis.chrome} chrome @param {() => Promise<{ ambient: number, commentary: number }>} volumes */
  constructor(chrome, volumes) {
    super();
    this.chrome = chrome;
    this.volumes = volumes;
    /** @type {Promise<void> | null} while creating the document */
    this.creating = null;
  }

  async isOpen() {
    return (await this.chrome.runtime.getContexts({ contextTypes: [/** @type {any} */ (CONTEXT)] })).length > 0;
  }

  /** Messages often come in pairs (walking moves both the ambient sound and
   * the commentary lookup); only one may create the document, a second
   * createDocument fails and its message would be lost. */
  async ensureOpen() {
    if (!this.creating)
      this.creating = this.create().finally(() => {
        this.creating = null;
      });
    await this.creating;
  }

  async create() {
    if (await this.isOpen()) return;
    await this.chrome.offscreen.createDocument({
      url: "offscreen.html",
      // Not only AUDIO_PLAYBACK, which closes the document after 30 s of silence
      // and with it a paused commentary or a voice still downloading.
      reasons: [/** @type {any} */ ("AUDIO_PLAYBACK"), /** @type {any} */ ("BLOBS")],
      justification: "Play ambient field recordings and spoken articles for the Street View location",
    });
  }

  /** Every message carries the current volumes. */
  async send(/** @type {object} */ msg) {
    await this.ensureOpen();
    const v = await this.volumes();
    return this.chrome.runtime.sendMessage({
      target: OffscreenMsg.TARGET,
      volume: v.ambient,
      commentaryVolume: v.commentary,
      ...msg,
    });
  }
}
