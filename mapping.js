// Key mapping window: walks through all actions and lets the player assign a gamepad button
// to each, like the Recalbox / EmulationStation input configuration.
let map = { ...SVG_DEFAULTS.buttonMap };
let step = -1; // index into SVG_ACTIONS being configured, -1 when idle
let single = false; // configuring just one action
let armed = false; // false until all buttons were released after the last assignment

const list = document.getElementById("list");
const promptEl = document.getElementById("prompt");
const statusEl = document.getElementById("status");

function render() {
  list.textContent = "";
  SVG_ACTIONS.forEach((a, i) => {
    const tr = list.insertRow();
    tr.className = i === step ? "current" : "";
    tr.style.cursor = "pointer";
    tr.insertCell().textContent = a.label;
    const td = tr.insertCell();
    td.className = "btn";
    td.textContent = map[a.id] == null ? "—" : `Button ${map[a.id]}`;
    tr.addEventListener("click", () => begin(i, true));
  });
  for (const id of ["skip", "cancel"]) document.getElementById(id).disabled = step < 0;
  document.getElementById("start").disabled = step >= 0;
  promptEl.textContent = "";
  if (step < 0) {
    promptEl.textContent = "Idle.";
  } else {
    const b = document.createElement("b");
    b.textContent = SVG_ACTIONS[step].label;
    promptEl.append("Press a button for ", b);
  }
}

function begin(i, one) {
  step = i;
  single = one;
  armed = false;
  render();
}

function end() {
  step = -1;
  render();
}

function advance() {
  armed = false;
  if (single || step + 1 >= SVG_ACTIONS.length) end();
  else { step++; render(); }
}

async function assign(idx) {
  const id = SVG_ACTIONS[step].id;
  // A button can only have one action: unassign it from any other action.
  for (const k of Object.keys(map)) if (map[k] === idx) map[k] = null;
  map[id] = idx;
  advance();
  await chrome.storage.sync.set({ buttonMap: map });
}

function poll() {
  const pads = [...navigator.getGamepads()].filter((g) => g && g.connected);
  statusEl.textContent = pads.length ? `Gamepad: ${pads[0].id}` : "No gamepad detected.";
  if (step < 0) return;
  const down = pads.flatMap((g) => g.buttons.flatMap((b, i) => (b.pressed ? [i] : [])));
  if (!down.length) armed = true; // wait for release so one press isn't taken twice
  else if (armed) assign(down[0]);
}

document.getElementById("start").addEventListener("click", () => begin(0, false));
document.getElementById("skip").addEventListener("click", advance);
document.getElementById("cancel").addEventListener("click", end);
document.getElementById("defaults").addEventListener("click", async () => {
  map = { ...SVG_DEFAULTS.buttonMap };
  end();
  await chrome.storage.sync.set({ buttonMap: map });
});
document.addEventListener("keydown", (e) => {
  if (step < 0) return;
  if (e.key === "Enter") advance();
  else if (e.key === "Escape") end();
});

chrome.storage.sync.get(SVG_DEFAULTS).then((s) => {
  map = { ...SVG_DEFAULTS.buttonMap, ...s.buttonMap };
  render();
});
setInterval(poll, 30);
