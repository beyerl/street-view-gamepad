import { test } from "node:test";
import assert from "node:assert/strict";
import { JumpService, Turn, WalkEdge } from "../../src/application/jump-service.js";
import { RouteKeeper } from "../../src/application/route-keeper.js";
import { UserPhotosService } from "../../src/application/user-photos-service.js";
import { GeoPoint } from "../../src/domain/geo.js";
import { MemoryStore } from "../../src/infrastructure/session-store.js";
import { SessionKey } from "../../src/shared/storage-keys.js";
import { fakeNavigator, fakeScheduler, fakeToast, flush, noLog, spy } from "../helpers/fakes.js";

// Looking east from PANO1, on the floor labelled "2".
const PANO = "https://www.google.com/maps/@52.5,13.4,3a,75y,90h,90t/data=!3m6!1e1!3m4!1sPANO1!2e0!7i16384!8i8192";
const HERE = new GeoPoint(52.5, 13.4);
const ONE = { ordinal: 0, label: "1" };
const TWO = { ordinal: 1, label: "2" };

/** A panorama `m` metres away at `bearing`, on floor `level`. */
const pano = (id, bearing, m, level) => {
  const { lat, lng } = HERE.offset(bearing, m);
  return { type: 2, id, lat, lng, level };
};

/**
 * @param {{ links?: object[], ahead?: object | null, level?: object | null, store?: MemoryStore }} o
 *   links: the current panorama's; ahead: what every search ahead finds
 */
function setup({ links = [], ahead = null, level = TWO, store = new MemoryStore() } = {}) {
  const scheduler = fakeScheduler();
  const navigator = fakeNavigator(PANO);
  const toast = fakeToast();
  const panoramas = {
    nearest: spy(async (point, radius) =>
      radius === 3 ? { type: 2, id: "PANO1", lat: 52.5, lng: 13.4, level, links } : ahead,
    ),
  };
  const photos = new UserPhotosService({ store, toast, onChange: () => jump.refresh(), log: noLog });
  const hint = { text: "", show: (t) => (hint.text = t) };
  const routes = new RouteKeeper(store, navigator, noLog);
  const jump = new JumpService({ panoramas, navigator, routes, scheduler, toast, hint, store, photos, log: noLog });
  scheduler.every(250, () => jump.updateAhead());
  return { jump, photos, store, scheduler, clock: scheduler.clock, navigator, toast, panoramas };
}

async function rested(env) {
  env.clock.tick(250 + 400);
  await flush();
  return env;
}

const assigned = (env) => env.navigator.assign.calls.map(([url]) => url.match(/!1s([^!]+)!2e/)[1]);

function stuck(env, edge = WalkEdge.FORWARD) {
  env.jump.onWalk(edge, true, env.clock.now());
  env.clock.tick(1300);
  env.jump.onWalk(null, true, env.clock.now());
}

test("a jump prefers the nearest point on the current floor, among the hits and their links", async () => {
  const upstairs = { ...pano("UP", 90, 10, ONE), links: [pano("SAME", 92, 30, TWO)] };
  const env = await rested(setup({ ahead: upstairs }));
  stuck(env);
  await flush();
  assert.deepEqual(assigned(env), ["SAME"]);
  assert.equal(env.store.get(SessionKey.INDOORS), "1");
});

test("with nothing on the current floor, a jump goes to another floor; outdoors, to the nearest", async () => {
  const env = await rested(setup({ ahead: pano("UP", 90, 10, ONE) }));
  stuck(env);
  await flush();
  assert.deepEqual(assigned(env), ["UP"]);

  const outdoors = { ...pano("FAR", 90, 30, null), links: [pano("NEAR", 90, 10, null)] };
  const out = await rested(setup({ ahead: outdoors, level: null }));
  stuck(out);
  await flush();
  assert.deepEqual(assigned(out), ["NEAR"]);
  assert.equal(out.store.get(SessionKey.INDOORS), "");
});

test("where Google would walk to another floor, the walk jumps along this one instead", async () => {
  const stairs = pano("STAIRS", 90, 5, ONE);
  const corridor = pano("CORRIDOR", 120, 8, TWO);
  const env = await rested(setup({ links: [stairs, corridor] }));
  assert.equal(env.jump.guardWalk(false), true);
  env.jump.onWalk(WalkEdge.FORWARD, true, env.clock.now()); // the same press: no second jump later
  await flush();
  assert.deepEqual(assigned(env), ["CORRIDOR"]);
  env.clock.tick(1300);
  env.jump.onWalk(null, true, env.clock.now());
  await flush();
  assert.equal(env.navigator.assign.calls.length, 1);
  assert.equal(env.jump.guardWalk(false), true); // the page is about to change: Google mustn't walk meanwhile
});

test("Google walks itself where it stays on the floor, outdoors, and where nothing else is ahead", async () => {
  const same = await rested(setup({ links: [pano("NEXT", 90, 5, TWO), pano("STAIRS", 270, 5, ONE)] }));
  assert.equal(same.jump.guardWalk(false), false);
  assert.equal(same.jump.guardWalk(true), true); // backwards are the stairs

  const outdoors = await rested(setup({ links: [pano("NEXT", 90, 5, null)], level: null }));
  assert.equal(outdoors.jump.guardWalk(false), false);

  // Only the stairs lead on: take them, as Google would.
  const stairsOnly = await rested(setup({ links: [pano("STAIRS", 100, 5, ONE)] }));
  assert.equal(stairsOnly.jump.guardWalk(false), true);
  await flush();
  assert.deepEqual(assigned(stairsOnly), ["STAIRS"]);
});

test("in a building, walking waits until the new panorama's floor is known", async () => {
  const fresh = setup({ links: [pano("NEXT", 90, 5, TWO)] });
  assert.equal(fresh.jump.guardWalk(false), false); // nothing known yet: as before

  const env = setup({ links: [pano("NEXT", 90, 5, TWO)], store: new MemoryStore({ [SessionKey.INDOORS]: "1" }) });
  assert.equal(env.jump.guardWalk(false), true);
  assert.equal(env.panoramas.nearest.calls.length, 1); // looked it up right away
  await flush();
  assert.equal(env.jump.guardWalk(false), false);
});

test("user photos: off skips them in every search, remembered for the tab; a toggle looks up anew", async () => {
  const store = new MemoryStore();
  const env = await rested(setup({ store, ahead: pano("UP", 90, 10, ONE) }));
  assert.equal(env.photos.allowed, true);
  assert.ok(env.panoramas.nearest.calls.every((c) => c[2].userPhotos === true));
  env.photos.toggle();
  assert.equal(env.toast.text, "User photos: skipped, Google's only");
  assert.equal(store.get(SessionKey.USER_PHOTOS_OFF), "1");
  const before = env.panoramas.nearest.calls.length;
  await rested(env);
  const later = env.panoramas.nearest.calls.slice(before);
  assert.equal(later.length, 10); // the floor here and 9 rings ahead
  assert.ok(later.every((c) => c[2].userPhotos === false));
  assert.equal(new UserPhotosService({ store, toast: fakeToast(), onChange: noLog, log: noLog }).allowed, false);
  env.photos.toggle();
  assert.equal(env.toast.text, "User photos: allowed");
});

test("strafing keeps to the floor too", async () => {
  const env = setup({ ahead: { ...pano("UP", 180, 10, ONE), links: [pano("SAME", 182, 25, TWO)] } });
  await rested(env);
  env.jump.strafe(Turn.RIGHT); // looking east: right is south
  await flush();
  assert.deepEqual(assigned(env), ["SAME"]);
});
