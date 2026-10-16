// Key mapping window: walks through all actions and lets the player assign a gamepad button
// or axis to each, like the Recalbox / EmulationStation input configuration.
// A binding is a button index, an axis direction ("a1+": axis 1 above 0.5, "a1-": below
// -0.5), or for a hat switch the axis value of one of its positions ("a9=-1.00"). Hat
// switches (a Joy-Con's stick on some systems) report one axis that rests outside -1..1.
const AXIS_ON = 0.5; // how far an axis must move from rest to count as pressed
const AXIS_OFF = 0.3; // and back within this to count as released
const HAT_STEP = 0.1; // a hat switch's positions are 2/7 apart
let map = { ...SVG_DEFAULTS.buttonMap };
let step = -1; // index into SVG_ACTIONS being configured, -1 when idle
let single = false; // configuring just one action
let armed = false; // false until all buttons were released after the last assignment
const rest = new Map(); // gamepad index -> its axes at rest, seen when configuring starts

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
    td.textContent = label(map[a.id]);
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
    promptEl.append("Press a button or move a stick for ", b);
  }
}

function label(binding) {
  if (binding == null) return "—";
  if (typeof binding === "number") return `Button ${binding}`;
  const [, axis, dir, value] = binding.match(/^a(\d+)(?:([+-])|=(.+))$/) || [];
  if (dir) return `Axis ${axis} ${dir}`;
  if (value) return `Axis ${axis} = ${value}`;
  return "?";
}

// What is pressed on a gamepad as bindings: buttons first, then axes moved from rest.
function inputs(g, threshold) {
  if (!rest.has(g.index)) rest.set(g.index, [...(g.axes || [])]);
  const r = rest.get(g.index);
  const out = g.buttons.flatMap((b, i) => (b.pressed ? [i] : []));
  (g.axes || []).forEach((v, i) => {
    const r0 = r[i] ?? 0, d = v - r0;
    if (Math.abs(r0) > 1) {
      if (Math.abs(d) > HAT_STEP) out.push(`a${i}=${v.toFixed(2)}`);
    } else if (Math.abs(d) > threshold) {
      out.push(`a${i}${d > 0 ? "+" : "-"}`);
    }
  });
  return out;
}

function begin(i, one) {
  rest.clear(); // sticks are at rest while the player clicks
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

async function assign(binding) {
  const id = SVG_ACTIONS[step].id;
  // A button or axis direction can only have one action: unassign it from any other action.
  for (const k of Object.keys(map)) if (map[k] === binding) map[k] = null;
  map[id] = binding;
  advance();
  await chrome.storage.sync.set({ buttonMap: map });
}

function poll() {
  const pads = [...navigator.getGamepads()].filter((g) => g && g.connected);
  statusEl.textContent = pads.length ? `Gamepad: ${pads[0].id}` : "No gamepad detected.";
  if (step < 0) return;
  const down = pads.flatMap((g) => inputs(g, AXIS_ON));
  const held = pads.some((g) => inputs(g, AXIS_OFF).length);
  if (!held) armed = true; // wait for release so one press isn't taken twice
  else if (armed && down.length) assign(down[0]);
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
