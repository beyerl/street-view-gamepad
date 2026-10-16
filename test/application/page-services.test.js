import { test } from "node:test";
import assert from "node:assert/strict";
import { AmbientReporter } from "../../src/application/ambient-reporter.js";
import { CommentaryClient } from "../../src/application/commentary-client.js";
import { LevelService } from "../../src/application/level-service.js";
import { MinimapService } from "../../src/application/minimap-service.js";
import { ModeService } from "../../src/application/mode-service.js";
import { OverlayService } from "../../src/application/overlay-service.js";
import { LevelStep } from "../../src/domain/levels.js";
import { Mode } from "../../src/domain/mode.js";
import { MemoryStore } from "../../src/infrastructure/session-store.js";
import { Msg } from "../../src/shared/messages.js";
import { SessionKey } from "../../src/shared/storage-keys.js";
import { fakeBus, fakeNavigator, fakeScheduler, fakeToast, noLog, spy } from "../helpers/fakes.js";

test("modes: start in floors, cycle, remember for the tab, notify", () => {
  const store = new MemoryStore();
  const modes = new ModeService(store, noLog);
  const seen = [];
  modes.onChange((m) => seen.push(m));
  assert.equal(modes.mode, Mode.LEVELS);
  modes.next();
  assert.equal(store.get(SessionKey.MODE), Mode.COMMENTARY);
  modes.next();
  assert.deepEqual(seen, [Mode.COMMENTARY, Mode.LEVELS]);
  assert.equal(new ModeService(new MemoryStore({ [SessionKey.MODE]: "commentary" }), noLog).mode, Mode.COMMENTARY);
  assert.equal(new ModeService(new MemoryStore({ [SessionKey.MODE]: "bogus" }), noLog).mode, Mode.LEVELS);
});

test("overlay: toggles, remembers, and keeps hiding re-rendered panels", () => {
  const page = { setOverlayHidden: spy() };
  const store = new MemoryStore();
  const overlay = new OverlayService(page, store, noLog);
  overlay.refresh();
  assert.equal(page.setOverlayHidden.calls.length, 0);
  overlay.toggle();
  overlay.refresh();
  assert.deepEqual(page.setOverlayHidden.calls, [[true], [true]]);
  assert.equal(store.get(SessionKey.OVERLAY_HIDDEN), "1");
  assert.equal(new OverlayService(page, store, noLog).hidden, true);
  overlay.toggle();
  assert.deepEqual(page.setOverlayHidden.calls.at(-1), [false]);
  assert.equal(store.get(SessionKey.OVERLAY_HIDDEN), "");
});

test("ambient: reports the position once per ~10 m and stops once", () => {
  const bus = fakeBus();
  const navigator = fakeNavigator("https://www.google.com/maps/@52.5,13.4,15z");
  const settings = { soundEnabled: true };
  let hidden = false;
  const ambient = new AmbientReporter({ bus, navigator, settings, isHidden: () => hidden });
  ambient.update();
  ambient.update();
  navigator.href = "https://www.google.com/maps/@52.500001,13.400001,15z";
  ambient.update();
  assert.deepEqual(bus.of(Msg.AMBIENT), [{ type: Msg.AMBIENT, lat: 52.5, lng: 13.4 }]);
  navigator.href = "https://www.google.com/maps/@52.6,13.4,15z";
  ambient.update();
  assert.equal(bus.of(Msg.AMBIENT)[1].lat, 52.6);
  hidden = true;
  ambient.update();
  ambient.update();
  assert.equal(bus.of(Msg.AMBIENT_STOP).length, 1);
  hidden = false;
  ambient.update();
  assert.equal(bus.of(Msg.AMBIENT).length, 3);
  settings.soundEnabled = false;
  ambient.update();
  navigator.href = "https://www.google.com/maps";
  ambient.update();
  assert.equal(bus.of(Msg.AMBIENT_STOP).length, 2);
});

function picker(labels, current = -1) {
  return { items: labels.map((label) => ({ el: { label }, label })), current };
}

test("floors: one up, one down, and says so without a picker", () => {
  const scheduler = fakeScheduler();
  const toast = fakeToast();
  const page = { found: null, lastLevel: "", findLevelPicker: () => page.found, click: spy() };
  const onSwitched = spy();
  const levels = new LevelService({ page, toast, scheduler, onSwitched, log: noLog });
  levels.switch(LevelStep.UP);
  assert.equal(toast.text, "No floors to switch between here.");
  assert.equal(levels.floor(), null);

  page.found = picker(["3", "2", "1"], 1);
  levels.switch(LevelStep.UP);
  levels.switch(LevelStep.DOWN);
  assert.deepEqual(
    page.click.calls.map(([el]) => el.label),
    ["3", "1"],
  );
  assert.equal(page.lastLevel, "1");
  assert.equal(levels.floor(), "2");
  scheduler.clock.tick(300);
  assert.equal(onSwitched.calls.length, 2);

  page.found = picker(["2", "1"], -1);
  assert.equal(levels.floor(), "");
});

test("minimap: clicks its size button, or says there is none", () => {
  const toast = fakeToast();
  const page = { map: null, button: null, minimap: () => page.map, minimapSizeButton: () => page.button, click: spy() };
  const minimap = new MinimapService(page, toast);
  minimap.toggle();
  assert.equal(toast.text, "No minimap here.");
  page.map = {};
  minimap.toggle();
  assert.equal(page.click.calls.length, 0);
  page.button = { b: 1 };
  minimap.toggle();
  assert.deepEqual(page.click.calls, [[{ b: 1 }]]);
});

function commentarySetup({ mode = Mode.LEVELS } = {}) {
  const bus = fakeBus();
  const navigator = fakeNavigator("https://www.google.com/maps/@52.5,13.4,15z");
  const modes = new ModeService(new MemoryStore({ [SessionKey.MODE]: mode }), noLog);
  const toast = fakeToast();
  const onChange = spy();
  let hidden = false;
  const c = new CommentaryClient({ bus, navigator, modes, toast, isHidden: () => hidden, onChange });
  return { c, bus, navigator, modes, toast, onChange, hide: (h) => (hidden = h) };
}

const state = (s) => ({ available: true, title: "A", status: "stopped", playingTitle: "", index: 0, count: 1, ...s });

test("commentary: looks up on entering the mode, then after moving 50 m, never when hidden", () => {
  const env = commentarySetup();
  env.c.lookup();
  assert.equal(env.bus.of(Msg.COMMENTARY_AT).length, 0); // floors mode
  env.modes.next();
  assert.deepEqual(env.bus.of(Msg.COMMENTARY_AT), [{ type: Msg.COMMENTARY_AT, lat: 52.5, lng: 13.4 }]);
  env.navigator.href = "https://www.google.com/maps/@52.5002,13.4,15z"; // 22 m
  env.c.lookup();
  assert.equal(env.bus.of(Msg.COMMENTARY_AT).length, 1);
  env.navigator.href = "https://www.google.com/maps/@52.501,13.4,15z"; // 111 m
  env.hide(true);
  env.c.lookup();
  assert.equal(env.bus.of(Msg.COMMENTARY_AT).length, 1);
  env.hide(false);
  env.c.lookup();
  assert.equal(env.bus.of(Msg.COMMENTARY_AT).length, 2);
  env.modes.next();
  env.modes.next(); // back in commentary: looks up again even without moving
  assert.equal(env.bus.of(Msg.COMMENTARY_AT).length, 3);
});

test("commentary: state and notices from the background", () => {
  const env = commentarySetup();
  env.bus.receive(Msg.COMMENTARY, { state: state({ title: "Tor" }) });
  assert.equal(env.c.state.title, "Tor");
  assert.equal(env.onChange.calls.length, 1);
  env.bus.receive(Msg.COMMENTARY_NOTICE, { message: "Downloading voice 40%…", ms: 0 });
  assert.equal(env.toast.text, "Downloading voice 40%…");
  env.bus.receive(Msg.COMMENTARY_NOTICE, { message: "" });
  assert.equal(env.toast.text, "");
});

test("commentary: the button toggles if there is something to play", () => {
  const env = commentarySetup({ mode: Mode.COMMENTARY });
  env.c.toggle();
  assert.equal(env.toast.text, "No commentary for this place.");
  env.bus.receive(Msg.COMMENTARY, { state: state({ available: false, status: "playing" }) });
  env.c.toggle();
  env.bus.receive(Msg.COMMENTARY, { state: state() });
  env.c.toggle();
  assert.equal(env.bus.of(Msg.COMMENTARY_TOGGLE).length, 2);
  env.c.pause();
  assert.equal(env.bus.of(Msg.COMMENTARY_PAUSE).length, 1);
});

test("commentary: next / previous switch to the mode first, then go through the articles", () => {
  const env = commentarySetup();
  env.c.next(1);
  assert.equal(env.modes.mode, Mode.COMMENTARY);
  assert.equal(env.bus.of(Msg.COMMENTARY_NEXT).length, 0);
  env.c.next(1);
  assert.equal(env.toast.text, "No commentary for this place.");
  env.bus.receive(Msg.COMMENTARY, { state: state() });
  env.c.next(1);
  assert.equal(env.toast.text, "No other article nearby.");
  env.bus.receive(Msg.COMMENTARY, { state: state({ count: 3 }) });
  env.c.next(1);
  env.c.next(-1);
  assert.deepEqual(
    env.bus.of(Msg.COMMENTARY_NEXT).map((m) => m.step),
    [1, -1],
  );
});
