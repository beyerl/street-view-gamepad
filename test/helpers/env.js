// Test harness: loads the extension's plain browser scripts into a vm context
// with hand-written stand-ins for the browser / extension APIs. No dependencies.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");

// Runs the source files, in order, in one fresh context (so top-level `const`s
// are shared like with several <script> tags). `ev(expr)` evaluates an
// expression in that context, which is how tests reach top-level bindings.
function loadScripts(files, globals = {}) {
  const ctx = vm.createContext({
    console: quietConsole(),
    URL, URLSearchParams, TextDecoder, TextEncoder, Blob, Response,
    ...globals,
  });
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx, { filename: file });
  }
  return { ctx, ev: (expr) => vm.runInContext(expr, ctx) };
}

// Values created inside the context have other prototypes than the test's own,
// which deepStrictEqual rejects; compare plain JSON copies instead.
const plain = (x) => JSON.parse(JSON.stringify(x));

// Lets pending promise callbacks run.
async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

function spy(impl = () => {}) {
  const f = (...args) => {
    f.calls.push(args);
    return impl(...args);
  };
  f.calls = [];
  return f;
}

function quietConsole() {
  return { log: spy(), warn: spy(), error: spy() };
}

// Fake time for setTimeout / setInterval / performance.now.
function makeClock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  const add = (fn, ms, every) => {
    const id = ++nextId;
    timers.set(id, { fn, at: now + (ms || 0), every });
    return id;
  };
  return {
    now: () => now,
    globals: {
      setTimeout: (fn, ms) => add(fn, ms),
      setInterval: (fn, ms) => add(fn, ms, ms),
      clearTimeout: (id) => timers.delete(id),
      clearInterval: (id) => timers.delete(id),
      performance: { now: () => now },
    },
    pending: () => timers.size,
    tick(ms) {
      const end = now + ms;
      for (;;) {
        let id = null, next = null;
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
}

function event() {
  const fns = [];
  return { fns, addListener: (f) => fns.push(f), emit: (...args) => fns.map((f) => f(...args)) };
}

function storageArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === "string") return keys in data ? { [keys]: data[keys] } : {};
      const out = {};
      if (Array.isArray(keys)) {
        for (const k of keys) if (k in data) out[k] = data[k];
      } else {
        for (const [k, def] of Object.entries(keys)) out[k] = k in data ? data[k] : def;
      }
      return out;
    },
    set: spy(async (items) => { Object.assign(data, items); }),
    remove: spy(async (k) => { delete data[k]; }),
  };
}

// The parts of the `chrome` extension API the scripts use.
function makeChrome({ sync, local, session, uiLanguage = "en-US", sendMessageResult } = {}) {
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
      sync: storageArea(sync), local: storageArea(local), session: storageArea(session),
      onChanged: event(),
    },
    tabs: { onRemoved: event(), sendMessage: spy(async () => {}) },
    windows: {
      get: spy(async () => ({ state: "normal" })),
      update: spy(async () => {}),
      create: spy(async () => {}),
    },
    declarativeNetRequest: { updateSessionRules: spy(async () => {}) },
    offscreen: { createDocument: spy(async () => { contexts.push({}); }) },
    i18n: { getUILanguage: () => uiLanguage },
  };
}

// Response stand-ins for fetch mocks.
const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const textResponse = (text) => ({ ok: true, status: 200, text: async () => text });
const errorResponse = (status) => ({ ok: false, status });

// window with message passing and event listeners; `message()` plays a
// postMessage from the page.
function makeWindow(props = {}) {
  const handlers = {};
  const w = {
    posted: [],
    innerWidth: 1000, innerHeight: 800,
    addEventListener: (type, f) => (handlers[type] ||= []).push(f),
    postMessage: (data) => w.posted.push(data),
    dispatch: (type, ev) => (handlers[type] || []).forEach((f) => f(ev)),
    message: (data, source = w) => w.dispatch("message", { source, data }),
    close: spy(),
    ...props,
  };
  return w;
}

module.exports = {
  ROOT, loadScripts, plain, flush, spy, quietConsole, makeClock, event, storageArea, makeChrome,
  jsonResponse, textResponse, errorResponse, makeWindow,
};
