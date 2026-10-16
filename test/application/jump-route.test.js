import { test } from "node:test";
import assert from "node:assert/strict";
import { JumpService, Turn, WalkEdge } from "../../src/application/jump-service.js";
import { RouteKeeper } from "../../src/application/route-keeper.js";
import { MemoryStore } from "../../src/infrastructure/session-store.js";
import { SessionKey } from "../../src/shared/storage-keys.js";
import { fakeNavigator, fakeScheduler, fakeToast, flush, noLog, spy } from "../helpers/fakes.js";

const MAP = "https://www.google.com/maps/@52.5,13.4,15z";
const PANO = "https://www.google.com/maps/@52.5,13.4,3a,75y,90h,90t/data=!3m6!1e1!3m4!1sPANO1!2e0!7i16384!8i8192";
const DIR = "dir/Berlin+Hbf/Brandenburger+Tor";
const ROUTE = "!4m9!4m8!1m3!2m2!1d13.36!2d52.52!1m3!2m2!1d13.37!2d52.51";
const ROUTE_PANO = `https://www.google.com/maps/${DIR}/@52.5,13.4,3a,75y,90h,90t/data=!3m6!1e1!3m4!1sPANO1!2e0!7i16384!8i8192${ROUTE}`;
const TARGET = "@52.5,13.400295,3a,75y,90.00h,90t/data=!3m4!1e1!3m2!1sPANO2!2e0";

// PANO2 lies 20 m east of PANO1.
const east = () => ({ nearest: spy(async () => ({ type: 2, id: "PANO2", lat: 52.5, lng: 13.400295 })) });

function setup({ href = PANO, panoramas = east(), store = new MemoryStore() } = {}) {
  const scheduler = fakeScheduler();
  const navigator = fakeNavigator(href);
  const toast = fakeToast();
  const hint = { text: "", show: (t) => (hint.text = t) };
  const log = spy();
  const routes = new RouteKeeper(store, navigator, noLog);
  const jump = new JumpService({ panoramas, navigator, routes, scheduler, toast, hint, log });
  scheduler.every(250, () => jump.updateAhead());
  return { jump, routes, store, scheduler, clock: scheduler.clock, navigator, toast, hint, panoramas, log };
}

async function rested(env) {
  env.clock.tick(250 + 400);
  await flush();
  return env;
}

/** A walk press, held for `ms`. */
function walk(env, ms = 1300, edge = WalkEdge.FORWARD) {
  env.jump.onWalk(edge, true, env.clock.now());
  for (let t = 0; t < ms; t += 16) {
    env.clock.tick(16);
    env.jump.onWalk(null, true, env.clock.now());
  }
}

test("shows the distance to the next panorama ahead, searching 9 rings", async () => {
  const env = await rested(setup());
  assert.equal(env.panoramas.nearest.calls.length, 9);
  const [point, radius] = env.panoramas.nearest.calls[0];
  assert.ok(Math.abs(point.lng - 13.4) > 0 && radius === 8 * 0.6);
  assert.equal(env.hint.text, "Next jump point 20 m");
});

test("looks up again only when the view turns; things behind are not ahead", async () => {
  const env = await rested(setup());
  env.clock.tick(2000);
  await flush();
  assert.equal(env.panoramas.nearest.calls.length, 9);
  env.navigator.href = PANO.replace("90h", "180h");
  await rested(env);
  assert.equal(env.panoramas.nearest.calls.length, 18);
  assert.equal(env.hint.text, "No jump point in this direction");
});

test("failed lookups count as nothing found and are logged", async () => {
  const env = await rested(
    setup({
      panoramas: {
        nearest: async () => {
          throw new Error("HTTP 500");
        },
      },
    }),
  );
  assert.equal(env.hint.text, "No jump point in this direction");
  assert.match(String(env.log.calls[0][1]), /HTTP 500/);
});

test("the hint goes away outside Street View, and a lookup finishing late is dropped", async () => {
  const env = await rested(setup());
  env.navigator.href = MAP;
  env.clock.tick(250);
  assert.equal(env.hint.text, "");

  const late = setup();
  late.clock.tick(650); // lookup running
  late.navigator.href = MAP;
  late.clock.tick(250);
  await flush();
  assert.equal(late.hint.text, "");
});

test("walking into a dead end jumps ahead, reusing the hint's lookup", async () => {
  const env = await rested(setup());
  walk(env);
  assert.deepEqual(env.navigator.assign.calls, [[`https://www.google.com/maps/${TARGET}`]]);
  assert.equal(env.panoramas.nearest.calls.length, 9);
  assert.equal(env.store.get(SessionKey.JUMPED), "1");
});

test("no jump when walking reached another panorama", async () => {
  const env = await rested(setup());
  env.jump.onWalk(WalkEdge.FORWARD, true, env.clock.now());
  env.navigator.href = PANO.replace("PANO1", "PANO3");
  env.clock.tick(1500);
  env.jump.onWalk(null, false, env.clock.now());
  assert.equal(env.navigator.assign.calls.length, 0);
});

test("holding forward: each new panorama restarts the wait", async () => {
  const env = await rested(setup());
  env.jump.onWalk(WalkEdge.FORWARD, true, 0 + env.clock.now());
  env.clock.tick(1000);
  env.navigator.href = PANO.replace("PANO1", "PANO3");
  env.jump.onWalk(null, true, env.clock.now());
  env.clock.tick(1000);
  env.jump.onWalk(null, true, env.clock.now());
  assert.equal(env.navigator.assign.calls.length, 0); // only 1 s on PANO3
  env.clock.tick(300);
  env.jump.onWalk(null, true, env.clock.now());
  await flush();
  assert.equal(env.navigator.assign.calls.length, 1);
});

test("walking back searches behind and says when nothing is there", async () => {
  const env = await rested(setup());
  walk(env, 1300, WalkEdge.BACK);
  assert.equal(env.toast.text, "Searching for the next Street View point…");
  await flush();
  assert.equal(env.panoramas.nearest.calls.length, 18);
  assert.equal(env.toast.text, "No Street View point found in this direction.");
  assert.deepEqual(env.toast.shown.at(-1), ["No Street View point found in this direction.", 2500]);
});

test("a search that ends after the view left is ignored", async () => {
  const env = await rested(setup());
  walk(env, 1300, WalkEdge.BACK);
  env.navigator.href = PANO.replace("PANO1", "PANO3");
  await flush();
  assert.equal(env.toast.text, "");
  assert.equal(env.navigator.assign.calls.length, 0);
});

test("cancel drops a pending check and hides the search message", async () => {
  const env = await rested(setup());
  walk(env, 1300, WalkEdge.BACK);
  env.jump.cancel();
  await flush();
  assert.equal(env.toast.text, "");
  assert.equal(env.navigator.assign.calls.length, 0);
});

test("strafing searches 90° to the side and keeps the view direction", async () => {
  const env = setup({ href: PANO.replace("90h", "0h") }); // looking north: PANO2 is to the right
  env.jump.strafe(Turn.LEFT);
  await flush();
  assert.equal(env.toast.text, "No Street View point found in this direction.");
  env.jump.strafe(Turn.RIGHT);
  await flush();
  assert.deepEqual(env.navigator.assign.calls, [[`https://www.google.com/maps/${TARGET.replace("90.00h", "0.00h")}`]]);
});

test("strafing does nothing on the map or while searching", async () => {
  const env = setup({ href: MAP });
  env.jump.strafe(Turn.RIGHT);
  assert.equal(env.panoramas.nearest.calls.length, 0);
  const busy = setup({ href: PANO.replace("90h", "0h") });
  busy.jump.strafe(Turn.RIGHT);
  busy.jump.strafe(Turn.RIGHT);
  await flush();
  assert.equal(busy.panoramas.nearest.calls.length, 9);
});

// --- route ------------------------------------------------------------------------------

test("a jump keeps the route and remembers it for the tab", async () => {
  const env = await rested(setup({ href: ROUTE_PANO }));
  walk(env);
  assert.equal(env.navigator.assign.calls[0][0], `https://www.google.com/maps/${DIR}/${TARGET}${ROUTE}`);
  assert.deepEqual(JSON.parse(env.store.get(SessionKey.ROUTE)), { dir: DIR, data: ROUTE });
});

test("after a jump the remembered route is used even if the URL doesn't show it", async () => {
  const store = new MemoryStore({
    [SessionKey.JUMPED]: "1",
    [SessionKey.ROUTE]: JSON.stringify({ dir: DIR, data: ROUTE }),
  });
  const env = await rested(setup({ store }));
  walk(env);
  assert.equal(env.navigator.assign.calls[0][0], `https://www.google.com/maps/${DIR}/${TARGET}${ROUTE}`);
});

test("a remembered route is dropped on a page load that wasn't a jump, or if it is garbage", () => {
  const stale = new MemoryStore({ [SessionKey.ROUTE]: JSON.stringify({ dir: DIR, data: ROUTE }) });
  assert.equal(new RouteKeeper(stale, fakeNavigator(PANO), noLog).current(), null);
  assert.equal(stale.get(SessionKey.ROUTE), null);
  const garbage = new MemoryStore({ [SessionKey.JUMPED]: "1", [SessionKey.ROUTE]: "{" });
  assert.equal(new RouteKeeper(garbage, fakeNavigator(PANO), noLog).current(), null);
});

test("closing the directions, or the map without them, forgets the route", () => {
  const nav = fakeNavigator(ROUTE_PANO);
  const store = new MemoryStore();
  const routes = new RouteKeeper(store, nav, noLog);
  routes.update();
  assert.ok(store.get(SessionKey.ROUTE));
  nav.href = PANO;
  routes.update();
  assert.equal(store.get(SessionKey.ROUTE), null);

  const after = new MemoryStore({
    [SessionKey.JUMPED]: "1",
    [SessionKey.ROUTE]: JSON.stringify({ dir: DIR, data: ROUTE }),
  });
  const nav2 = fakeNavigator(PANO);
  const kept = new RouteKeeper(after, nav2, noLog);
  kept.update();
  assert.ok(after.get(SessionKey.ROUTE)); // the URL after a jump may not show it
  nav2.href = MAP;
  kept.update();
  assert.equal(after.get(SessionKey.ROUTE), null);
});
