// Composition root of the key mapping window.

import { KeyMappingSession } from "../application/key-mapping.js";
import { GamepadInput } from "../infrastructure/browser.js";
import { defineSettingsComponents, ROW_SELECT } from "../presentation/settings-components.js";

const POLL = 30;

/** @param {any} g */
export function startMapping(g) {
  const { document, chrome } = g;
  defineSettingsComponents(g);
  const table = document.getElementById("list");
  const promptEl = document.getElementById("prompt");
  const statusEl = document.getElementById("status");
  const input = new GamepadInput(g.navigator);

  const render = () => {
    const s = session;
    table.render(
      s.actions.map((a) => ({ label: a.label, binding: s.map[a.id] })),
      s.step,
    );
    for (const id of ["skip", "cancel"]) document.getElementById(id).disabled = !s.configuring;
    document.getElementById("start").disabled = s.configuring;
    promptEl.textContent = "";
    if (!s.configuring) {
      promptEl.textContent = "Idle.";
    } else {
      const b = document.createElement("b");
      b.textContent = s.actions[s.step].label;
      promptEl.append("Press a button or move a stick for ", b);
    }
  };
  const session = new KeyMappingSession({
    save: (map) => chrome.storage.sync.set({ buttonMap: map }),
    onChange: render,
  });

  table.addEventListener(ROW_SELECT, (/** @type {CustomEvent} */ e) => session.begin(e.detail.index, true));
  document.getElementById("start").addEventListener("click", () => session.begin(0, false));
  document.getElementById("skip").addEventListener("click", () => session.advance());
  document.getElementById("cancel").addEventListener("click", () => session.end());
  document.getElementById("defaults").addEventListener("click", () => session.reset());
  document.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
    if (!session.configuring) return;
    if (e.key === "Enter") session.advance();
    else if (e.key === "Escape") session.end();
  });

  g.setInterval(() => {
    const pads = input.pads();
    statusEl.textContent = pads.length ? `Gamepad: ${pads[0].id}` : "No gamepad detected.";
    session.poll(pads);
  }, POLL);

  render();
  const ready = chrome.storage.sync.get("buttonMap").then((/** @type {any} */ s) => session.load(s.buttonMap || {}));
  return { session, ready };
}
