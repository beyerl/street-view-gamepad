import { after, test } from "node:test";
import assert from "node:assert/strict";
import { hudChips, placeBox } from "../../src/presentation/hud-model.js";
import { defineComponents, Tag } from "../../src/presentation/components.js";
import { HintView, HudView, ToastView } from "../../src/presentation/views.js";
import { defineSettingsComponents, ROW_SELECT, SETTING_CHANGE } from "../../src/presentation/settings-components.js";
import { closeDoms, makeDom, setRect } from "../helpers/dom.js";
import { fakeScheduler } from "../helpers/fakes.js";

after(closeDoms);

const c = (s = {}) => ({ available: false, title: "", status: "stopped", playingTitle: "", index: 0, count: 0, ...s });

test("chips: the active mode, floors, and every commentary state", () => {
  const chips = hudChips({ mode: "levels", floor: "2", commentary: c() });
  assert.deepEqual(chips, [
    { id: "levels", active: true, on: true, playing: false, label: "Floor 2" },
    { id: "commentary", active: false, on: false, playing: false, label: "Nothing nearby" },
  ]);
  assert.equal(hudChips({ mode: "levels", floor: "", commentary: c() })[0].label, "Floor ?");
  assert.deepEqual(hudChips({ mode: "levels", floor: null, commentary: c() })[0], {
    id: "levels",
    active: true,
    on: false,
    playing: false,
    label: "No floors here",
  });
  const label = (s) => hudChips({ mode: "commentary", floor: null, commentary: c(s) })[1];
  assert.equal(label({ available: true, title: "Tor" }).label, "Tor");
  assert.equal(label({ available: true, title: "Tor", index: 1, count: 3 }).label, "Tor (2/3)");
  assert.deepEqual(label({ status: "playing", playingTitle: "Tor" }), {
    id: "commentary",
    active: true,
    on: true,
    playing: true,
    label: "Tor",
  });
  assert.equal(label({ status: "paused", playingTitle: "Tor" }).label, "⏸ Tor");
});

test("placement: in the corner, else beside or above Maps' controls", () => {
  const vp = { width: 1000, height: 800 };
  const box = { width: 100, height: 40 };
  assert.deepEqual(placeBox(vp, box, [], 12), { right: 12, bottom: 12 });
  const zoom = { left: 940, top: 650, right: 980, bottom: 790 };
  assert.deepEqual(placeBox(vp, box, [zoom], 12), { right: 66, bottom: 12 });
  const bar = { left: 400, top: 760, right: 1000, bottom: 800 };
  assert.deepEqual(placeBox(vp, box, [bar], 12), { right: 12, bottom: 46 });
  const everywhere = { left: 0, top: 0, right: 1000, bottom: 800 };
  assert.deepEqual(placeBox(vp, box, [everywhere], 12), { right: 12, bottom: 12 });
});

function page() {
  const { window, document } = makeDom();
  defineComponents(window);
  defineComponents(window); // defining twice is harmless
  return { window, document };
}

test("components live in Shadow DOM: toast and hint show text, the HUD renders chips", () => {
  const { document } = page();
  const toast = document.createElement(Tag.TOAST);
  toast.text = "Hello <b>";
  assert.equal(toast.text, "Hello <b>");
  assert.match(toast.shadowRoot.querySelector("style").textContent, /translate\(-50%, -50%\)/);
  const hud = document.createElement(Tag.HUD);
  hud.render(hudChips({ mode: "commentary", floor: null, commentary: c({ status: "playing", playingTitle: "Tor" }) }));
  hud.render(hudChips({ mode: "commentary", floor: null, commentary: c({ status: "playing", playingTitle: "Tor" }) }));
  assert.equal(hud.shadowRoot.querySelectorAll(".m").length, 2);
  const chip = hud.chip("commentary");
  assert.equal(chip.className, "m active on playing");
  assert.equal(chip.querySelector("span").textContent, "Tor");
  assert.ok(chip.querySelector("svg"));
  assert.equal(document.body.querySelector(".m"), null); // nothing leaks into the page
});

test("components set no attributes when constructed, or Chrome rejects them; views start hidden", () => {
  const { document } = page();
  for (const tag of Object.values(Tag)) assert.equal(document.createElement(tag).hasAttributes(), false, tag);
  const scheduler = fakeScheduler();
  assert.equal(new ToastView(document, scheduler).el.hidden, true);
  assert.equal(new HintView(document).el.hidden, true);
});

test("toast view: shows, hides after a while, a new message replaces the timer", () => {
  const { document } = page();
  const scheduler = fakeScheduler();
  const toast = new ToastView(document, scheduler);
  assert.equal(toast.text, "");
  toast.show("A", 1500);
  assert.equal(toast.el.isConnected, true);
  assert.equal(toast.text, "A");
  scheduler.clock.tick(1000);
  toast.show("B");
  scheduler.clock.tick(1000);
  assert.equal(toast.text, "B"); // the first timer was cancelled
  toast.hide();
  assert.equal(toast.text, "");
});

test("hint view: shows text, hides when empty", () => {
  const { document } = page();
  const hint = new HintView(document);
  hint.show("");
  assert.equal(hint.el.isConnected, false);
  hint.show("Next jump point 20 m");
  assert.equal(hint.text, "Next jump point 20 m");
  hint.show("");
  assert.equal(hint.text, "");
});

test("HUD view: only with a gamepad; placed clear of obstacles", () => {
  const { document, window } = page();
  const obstacles = [];
  const hud = new HudView(document, window, { obstacles: () => obstacles });
  const state = { mode: "levels", floor: null, commentary: c() };
  hud.render(false, state);
  assert.equal(hud.el.isConnected, false);
  hud.place(); // hidden: nothing
  hud.render(true, state);
  assert.equal(hud.el.hidden, false);
  setRect(hud.el, 0, 0, 100, 40);
  obstacles.push({ left: 940, top: 650, right: 980, bottom: 790 });
  hud.place();
  assert.deepEqual([hud.el.style.right, hud.el.style.bottom], ["66px", "12px"]);
  hud.render(false, state);
  assert.equal(hud.el.hidden, true);
});

test("settings components: ranges, checkboxes and selects report changes", () => {
  const { window, document } = makeDom("chrome-extension://x/popup.html");
  defineSettingsComponents(window);
  document.body.innerHTML = `
    <svgp-setting key="volume" label="Volume" type="range" min="0" max="100" step="1"></svgp-setting>
    <svgp-setting key="soundEnabled" label="Sound" type="checkbox"></svgp-setting>
    <svgp-setting key="logLevel" label="Log" type="select" options="off:Off|info:Info"></svgp-setting>`;
  const [vol, sound, level] = document.querySelectorAll("svgp-setting");
  const changes = [];
  document.addEventListener(SETTING_CHANGE, (e) => changes.push(e.detail));
  vol.value = 40;
  assert.equal(document.getElementById("volume").value, "40");
  assert.equal(vol.querySelector("output").textContent, "40");
  assert.equal(vol.querySelector("span").textContent, "Volume");
  sound.value = false;
  level.value = "info";
  assert.deepEqual(
    [...level.querySelectorAll("option")].map((o) => o.textContent),
    ["Off", "Info"],
  );
  const input = document.getElementById("volume");
  input.value = "70";
  input.dispatchEvent(new window.Event("input"));
  const box = document.getElementById("soundEnabled");
  box.checked = true;
  box.dispatchEvent(new window.Event("input"));
  assert.deepEqual(changes, [
    { key: "volume", value: 70 },
    { key: "soundEnabled", value: true },
  ]);
  assert.equal(level.value, "info");
});

test("settings components: a value set before connecting is applied", () => {
  const { window, document } = makeDom("chrome-extension://x/popup.html");
  defineSettingsComponents(window);
  const el = document.createElement("svgp-setting");
  el.setAttribute("key", "lookSpeedX");
  el.setAttribute("label", "Speed");
  el.setAttribute("max", "2400");
  el.value = 720;
  assert.equal(el.value, 720);
  document.body.appendChild(el);
  assert.equal(el.value, 720);
});

test("binding table: rows with labels, the current one marked, clicks select", () => {
  const { window, document } = makeDom("chrome-extension://x/mapping.html");
  defineSettingsComponents(window);
  const table = document.createElement("svgp-binding-table");
  document.body.appendChild(table);
  assert.deepEqual(table.rows, []);
  table.render(
    [
      { label: "Forward", binding: 3 },
      { label: "Step left", binding: null },
      { label: "Back", binding: "a1+" },
    ],
    1,
  );
  const rows = table.querySelectorAll("tr");
  assert.deepEqual(
    [...rows].map((r) => [...r.children].map((td) => td.textContent)),
    [
      ["Forward", "Button 3"],
      ["Step left", "—"],
      ["Back", "Axis 1 +"],
    ],
  );
  assert.equal(rows[1].className, "current");
  let selected;
  table.addEventListener(ROW_SELECT, (e) => (selected = e.detail.index));
  rows[2].dispatchEvent(new window.MouseEvent("click"));
  assert.equal(selected, 2);
});
