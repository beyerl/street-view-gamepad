// Stand-ins for the ports and for browser / extension APIs. No test reaches
// into a module's internals: services get these through their constructors.

export function spy(impl = (..._args) => {}) {
  const f = (...args) => {
    f.calls.push(args);
    return impl(...args);
  };
  f.calls = [];
  return f;
}

/** Lets pending promise callbacks run. */
export async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

/** Fake time for setTimeout / setInterval / now. */
export function makeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const add = (fn, ms, every) => {
    const id = ++nextId;
    timers.set(id, { fn, at: now + (ms || 0), every });
    return id;
  };
  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => add(fn, ms),
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    pending: () => timers.size,
    tick(ms) {
      const end = now + ms;
      for (;;) {
        let id = null;
        let next = null;
        for (const [i, t] of timers) if (t.at <= end && (!next || t.at < next.at)) [id, next] = [i, t];
        if (!next) break;
        now = next.at;
        if (next.every) next.at += next.every;
        else timers.delete(id);
        next.fn();
      }
      now = end;
    },
  };
  return clock;
}

/** A Scheduler port on a fake clock. */
export function fakeScheduler(clock = makeClock()) {
  return {
    clock,
    every: (ms, fn) => clock.setInterval(fn, ms),
    after: (ms, fn) => clock.setTimeout(fn, ms),
    cancel: (h) => clock.clearTimeout(h),
    now: () => clock.now(),
  };
}

export function fakeToast() {
  const t = {
    text: "",
    shown: [],
    show: (text, ms = 0) => {
      t.text = text;
      t.shown.push([text, ms]);
    },
    hide: () => {
      t.text = "";
    },
  };
  return t;
}

export function fakeBus() {
  const handlers = new Map();
  const bus = {
    posted: [],
    post: (type, payload = {}) => bus.posted.push({ type, ...payload }),
    on: (type, h) => (handlers.get(type) || handlers.set(type, []).get(type)).push(h),
    /** Plays a message arriving from the other side. */
    receive: (type, payload = {}) => (handlers.get(type) || []).forEach((h) => h({ type, ...payload })),
    of: (type) => bus.posted.filter((m) => m.type === type),
  };
  return bus;
}

export function fakeNavigator(href = "https://www.google.com/maps/@52.5,13.4,15z") {
  return { href, origin: "https://www.google.com", search: "", assign: spy(), back: spy(), forward: spy() };
}

export const noLog = () => {};

/** A gamepad with these buttons pressed (and these axes). */
export function pad(pressed = [], axes = [], index = 0) {
  return {
    index,
    id: `Pad ${index}`,
    connected: true,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
    axes,
  };
}

// --- chrome.* -------------------------------------------------------------------------

export function event() {
  const fns = [];
  return { fns, addListener: (f) => fns.push(f), emit: (...args) => fns.map((f) => f(...args)) };
}

export function storageArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys == null) return structuredClone(data);
      if (typeof keys === "string") return keys in data ? { [keys]: structuredClone(data[keys]) } : {};
      const out = {};
      if (Array.isArray(keys)) {
        for (const k of keys) if (k in data) out[k] = data[k];
      } else {
        for (const [k, def] of Object.entries(keys)) out[k] = k in data ? data[k] : def;
      }
      return out;
    },
    set: spy(async (items) => {
      Object.assign(data, structuredClone(items));
    }),
    remove: spy(async (k) => {
      delete data[k];
    }),
  };
}

/** The parts of the chrome extension API the extension uses. */
export function makeChrome({ sync, local, session, uiLanguage = "en-US", sendMessageResult } = {}) {
  const contexts = []; // open offscreen documents
  return {
    offscreenContexts: contexts,
    runtime: {
      id: "ext-id",
      onMessage: event(),
      sendMessage: spy(async () => sendMessageResult),
      getURL: (p) => `chrome-extension://ext-id/${p}`,
      getManifest: () => ({ version: "1.2.3" }),
      getContexts: async () => [...contexts],
    },
    storage: {
      sync: storageArea(sync),
      local: storageArea(local),
      session: storageArea(session),
      onChanged: event(),
    },
    tabs: { onRemoved: event(), sendMessage: spy(async () => {}) },
    windows: {
      get: spy(async () => ({ state: "normal" })),
      update: spy(async () => {}),
      create: spy(async () => {}),
    },
    declarativeNetRequest: { updateSessionRules: spy(async () => {}) },
    offscreen: {
      createDocument: spy(async () => {
        contexts.push({});
      }),
    },
    i18n: { getUILanguage: () => uiLanguage },
  };
}

// --- fetch ------------------------------------------------------------------------------

export const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
export const textResponse = (text) => ({ ok: true, status: 200, text: async () => text });
export const errorResponse = (status) => ({ ok: false, status });

/** fetch that answers by URL: routes are [predicate(url), body | (url) => body | Response]. */
export function router(routes) {
  return spy(async (url) => {
    for (const [match, body] of routes) {
      if (!match(String(url))) continue;
      const out = typeof body === "function" ? body(String(url)) : body;
      return out && "ok" in out ? out : jsonResponse(out);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

/** Values made in another realm (happy-dom, vm) compared as plain JSON. */
export const plain = (x) => JSON.parse(JSON.stringify(x));
