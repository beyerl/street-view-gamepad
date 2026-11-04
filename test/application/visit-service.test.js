import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteKeeper } from "../../src/application/route-keeper.js";
import { VisitService } from "../../src/application/visit-service.js";
import { VisitState } from "../../src/domain/visit.js";
import { MemoryStore } from "../../src/infrastructure/session-store.js";
import { Msg } from "../../src/shared/messages.js";
import { SessionKey } from "../../src/shared/storage-keys.js";
import { fakeBus, fakeNavigator, fakeToast, flush, noLog, pad, spy } from "../helpers/fakes.js";

const ROUTE =
  "https://www.google.com/maps/dir/35.6812,139.7649/35.6797,139.7546/@35.6812,139.7649,18z/data=!4m2!4m1!3e2";
const PANO =
  "https://www.google.com/maps/@35.6813,139.765,3a,75y,265h,90t/data=!3m6!1e1!3m4!1sPANO1!2e0!7i16384!8i8192";

const visit = (over = {}) => ({
  slot: "g1",
  returnUrl: "https://beyerl.github.io/virtual-visit/#visit=g1",
  origin: "35.6812,139.7649",
  destination: "35.6797,139.7546",
  state: VisitState.ENTERING,
  finished: false,
  position: null,
  startedAt: 1,
  ...over,
});

function setup({ href = ROUTE, nearest = async () => ({ type: 2, id: "PANO1", lat: 35.6813, lng: 139.765 }) } = {}) {
  const bus = fakeBus();
  const navigator = fakeNavigator(href);
  const panoramas = { nearest: spy(nearest) };
  const state = { pads: [] };
  const input = { pads: () => state.pads };
  const toast = fakeToast();
  const store = new MemoryStore();
  const routes = new RouteKeeper(store, navigator, noLog);
  const svc = new VisitService({
    bus,
    navigator,
    panoramas,
    input,
    toast,
    store,
    isHidden: () => false,
    routes,
    log: noLog,
  });
  return { svc, bus, navigator, panoramas, state, toast, store };
}

test("visit service: asks for the visit; nothing happens without one", () => {
  const env = setup();
  assert.equal(env.bus.of(Msg.GET_VISIT).length, 1);
  env.bus.receive(Msg.VISIT, { visit: null });
  env.state.pads = [pad([4, 5])];
  env.svc.tick();
  env.svc.update();
  assert.equal(env.bus.posted.length, 1);
});

test("visit service: enters Street View at the route start, facing the destination, keeping the route", async () => {
  const env = setup();
  env.bus.receive(Msg.VISIT, { visit: visit() });
  await flush();
  assert.equal(env.panoramas.nearest.calls[0][1], 50);
  assert.equal(env.bus.of(Msg.VISIT_ENTERED).length, 1);
  const [url] = env.navigator.assign.calls[0];
  assert.match(
    url,
    /^https:\/\/www\.google\.com\/maps\/dir\/35\.6812,139\.7649\/35\.6797,139\.7546\/@35\.6813,139\.765,3a,75y,2\d\d\.\d\dh,90t\/data=!3m4!1e1!3m2!1sPANO1!2e0!4m2!4m1!3e2$/,
  );
  assert.equal(env.toast.shown[0][0], "Virtual Visit: press L + R together to finish this stop.");
  // Kept for the next page, even if Maps drops the route from its URL before the page script looks.
  assert.equal(env.store.get(SessionKey.JUMPED), "1");
  const next = new RouteKeeper(
    env.store,
    fakeNavigator(url.replace(/\/maps\/dir\/[^@]*/, "/maps/").replace("!4m2!4m1!3e2", "")),
    noLog,
  );
  assert.deepEqual(next.current(), { dir: "dir/35.6812,139.7649/35.6797,139.7546", data: "!4m2!4m1!3e2" });
});

test("visit service: widens the search, and says so when there is no panorama", async () => {
  const env = setup({ nearest: async () => null });
  env.bus.receive(Msg.VISIT, { visit: visit() });
  await flush();
  assert.deepEqual(
    env.panoramas.nearest.calls.map((c) => c[1]),
    [50, 250],
  );
  assert.equal(env.navigator.assign.calls.length, 0);
  assert.match(env.toast.text, /No Street View/);
});

test("visit service: already in Street View (resuming), it only marks the visit entered", async () => {
  const env = setup({ href: PANO });
  env.bus.receive(Msg.VISIT, { visit: visit() });
  await flush();
  assert.equal(env.panoramas.nearest.calls.length, 0);
  assert.equal(env.bus.of(Msg.VISIT_ENTERED).length, 1);
});

test("visit service: reports each new position once; greets once per stop and tab", () => {
  const env = setup({ href: PANO });
  env.bus.receive(Msg.VISIT, { visit: visit({ state: VisitState.VISITING }) });
  env.svc.update();
  env.svc.update();
  assert.deepEqual(env.bus.of(Msg.VISIT_MOVED), [
    { type: Msg.VISIT_MOVED, position: { lat: 35.6813, lng: 139.765, heading: 265, url: PANO } },
  ]);
  env.navigator.href = PANO.replace("PANO1", "PANO2");
  env.svc.update();
  assert.equal(env.bus.of(Msg.VISIT_MOVED).length, 2);
  env.bus.receive(Msg.VISIT, { visit: visit({ state: VisitState.VISITING }) });
  assert.equal(env.toast.shown.length, 1);
});

test("visit service: L + R together finishes the stop, once", () => {
  const env = setup({ href: PANO });
  env.bus.receive(Msg.VISIT, { visit: visit({ state: VisitState.VISITING }) });
  env.state.pads = [pad([4])];
  env.svc.tick();
  assert.equal(env.bus.of(Msg.VISIT_FINISH).length, 0);
  env.state.pads = [pad([4, 5])];
  env.svc.tick();
  env.svc.tick();
  env.state.pads = [];
  env.svc.tick();
  env.state.pads = [pad([4, 5])];
  env.svc.tick();
  assert.equal(env.bus.of(Msg.VISIT_FINISH).length, 1);
  assert.equal(env.toast.text, "Back to Virtual Visit…");
  assert.equal(env.bus.of(Msg.VISIT_MOVED).length, 1, "the last position is reported first");
});

test("visit service: a finished visit is ignored", async () => {
  const env = setup();
  env.bus.receive(Msg.VISIT, { visit: visit({ finished: true }) });
  await flush();
  env.state.pads = [pad([4, 5])];
  env.svc.tick();
  assert.equal(env.panoramas.nearest.calls.length, 0);
  assert.equal(env.bus.of(Msg.VISIT_FINISH).length, 0);
});
