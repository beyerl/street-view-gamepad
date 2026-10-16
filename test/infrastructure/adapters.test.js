import { test } from "node:test";
import assert from "node:assert/strict";
import { TickScheduler } from "../../src/infrastructure/scheduler.js";
import { MemoryStore, SessionStore } from "../../src/infrastructure/session-store.js";
import { WindowMessageBus } from "../../src/infrastructure/window-message-bus.js";
import { GamepadInput, LocationNavigator } from "../../src/infrastructure/browser.js";
import { makeLogger, plainLogger } from "../../src/infrastructure/logger.js";
import { PhotometaPanoramaRepository } from "../../src/infrastructure/photometa-panorama-repository.js";
import { GeoPoint } from "../../src/domain/geo.js";
import { errorResponse, makeClock, spy, textResponse } from "../helpers/fakes.js";

test("scheduler: one base timer runs every() tasks at their periods; after/cancel use timeouts", () => {
  const clock = makeClock();
  const s = new TickScheduler(clock, 16);
  const fast = spy();
  const slow = spy();
  s.every(16, fast);
  s.every(1000, slow);
  assert.equal(clock.pending(), 1);
  clock.tick(1010); // the base tick after 1000 ms
  assert.ok(fast.calls.length >= 60 && fast.calls.length <= 64);
  assert.equal(slow.calls.length, 1);
  const once = spy();
  const h = s.after(50, once);
  s.after(10, once);
  s.cancel(h);
  clock.tick(100);
  assert.equal(once.calls.length, 1);
  assert.equal(s.now(), 1110);
});

test("scheduler: a stalled tab doesn't make tasks catch up", () => {
  const clock = makeClock();
  const s = new TickScheduler({ ...clock, setInterval: (fn) => ((s.fire = fn), 1) }, 16);
  const slow = spy();
  s.every(1000, slow);
  clock.tick(5000);
  s.fire();
  s.fire();
  assert.equal(slow.calls.length, 1);
});

test("session store: survives storage that throws; memory store for tests", () => {
  const data = new Map();
  const ok = new SessionStore(() => ({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  }));
  ok.set("a", "1");
  assert.equal(ok.get("a"), "1");
  ok.remove("a");
  assert.equal(ok.get("a"), null);
  const broken = new SessionStore(() => {
    throw new Error("SecurityError");
  });
  broken.set("a", "1");
  broken.remove("a");
  assert.equal(broken.get("a"), null);
  const mem = new MemoryStore({ x: "y" });
  assert.equal(mem.get("x"), "y");
  mem.remove("x");
  assert.equal(mem.get("x"), null);
});

test("message bus: posts with its source, delivers only the other side's messages by type", () => {
  const listeners = [];
  const window = {
    posted: [],
    addEventListener: (_t, f) => listeners.push(f),
    postMessage: (d, o) => window.posted.push([d, o]),
  };
  const bus = new WindowMessageBus(window, { send: "me", accept: "them" });
  const got = spy();
  bus.on("hello", got);
  bus.post("hi", { a: 1 });
  assert.deepEqual(window.posted, [[{ source: "me", type: "hi", a: 1 }, "*"]]);
  const emit = (data, source = window) => listeners.forEach((f) => f({ source, data }));
  emit({ source: "them", type: "hello", x: 1 });
  emit({ source: "me", type: "hello" });
  emit({ source: "them", type: "hello" }, {});
  emit({ source: "them", type: "other" });
  emit(null);
  assert.deepEqual(got.calls, [[{ source: "them", type: "hello", x: 1 }]]);
});

test("navigator and gamepads", () => {
  const location = { href: "h", origin: "o", search: "?s", assign: spy() };
  const history = { back: spy(), forward: spy() };
  const nav = new LocationNavigator(location, history);
  nav.assign("u");
  nav.back();
  nav.forward();
  assert.deepEqual(
    [nav.href, nav.origin, nav.search, location.assign.calls, history.back.calls.length, history.forward.calls.length],
    ["h", "o", "?s", [["u"]], 1, 1],
  );
  const pads = new GamepadInput({
    getGamepads: () => [null, { connected: false }, { connected: true, id: "X" }],
  }).pads();
  assert.deepEqual(pads, [{ connected: true, id: "X" }]);
});

test("loggers", () => {
  const console = { log: spy() };
  let level = "info";
  const log = makeLogger(console, () => level);
  log("info", "a", 1);
  log("debug", "b");
  level = "debug";
  log("debug", "c");
  plainLogger(console)("d");
  assert.deepEqual(console.log.calls, [
    ["[Street View Gamepad]", "a", 1],
    ["[Street View Gamepad]", "c"],
    ["[Street View Gamepad]", "d"],
  ]);
});

const reply = (type, id, lat, lng) =>
  textResponse(
    `)]}'\n${JSON.stringify([null, [null, [type, id], null, null, null, [[null, [[null, null, lat, lng]]]]]])}`,
  );

test("photometa: asks the endpoint around the point and parses the nearest panorama", async () => {
  const fetch = spy(async () => reply(2, "PANO2", 52.5, 13.4003));
  const repo = new PhotometaPanoramaRepository(fetch);
  assert.deepEqual(await repo.nearest(new GeoPoint(52.5, 13.4), 4.8), {
    type: 2,
    id: "PANO2",
    lat: 52.5,
    lng: 13.4003,
  });
  const pb = decodeURIComponent(fetch.calls[0][0].split("pb=")[1]);
  assert.ok(fetch.calls[0][0].startsWith("/maps/photometa/si/v1?pb="));
  assert.match(pb, /!3d52\.5!4d13\.4!2d5!/);
});

test("photometa: nothing found, or an HTTP error", async () => {
  assert.equal(
    await new PhotometaPanoramaRepository(async () => textResponse(")]}'\n[null,null]")).nearest(new GeoPoint(0, 0), 8),
    null,
  );
  await assert.rejects(
    new PhotometaPanoramaRepository(async () => errorResponse(500)).nearest(new GeoPoint(0, 0), 8),
    /HTTP 500/,
  );
});
