import { MessageBus } from "../ports/index.js";

/** window.postMessage between the page script and the bridge. Messages carry
 * a `source` so each side only listens to the other. @implements {MessageBus} */
export class WindowMessageBus extends MessageBus {
  /** @param {Window} window @param {{ send: string, accept: string }} sources */
  constructor(window, { send, accept }) {
    super();
    this.window = window;
    this.send = send;
    /** @type {Map<string, ((msg: any) => void)[]>} */
    this.handlers = new Map();
    window.addEventListener("message", (e) => {
      if (e.source !== window || e.data?.source !== accept) return;
      for (const h of this.handlers.get(e.data.type) || []) h(e.data);
    });
  }
  post(/** @type {string} */ type, payload = {}) {
    this.window.postMessage({ source: this.send, type, ...payload }, "*");
  }
  on(/** @type {string} */ type, /** @type {(msg: any) => void} */ handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(handler);
  }
}
