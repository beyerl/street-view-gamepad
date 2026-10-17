// Everything a gamepad button (or axis) can be assigned to. The one list of
// actions: the key mapping window, the presets and the input controller all
// read it. What the three mode buttons do depends on the mode (see mode.js).

/** Action ids. */
export const Action = Object.freeze({
  FORWARD: "forward",
  BACK: "back",
  STRAFE_LEFT: "strafeLeft",
  STRAFE_RIGHT: "strafeRight",
  LOOK_UP: "lookUp",
  LOOK_DOWN: "lookDown",
  LOOK_LEFT: "lookLeft",
  LOOK_RIGHT: "lookRight",
  ZOOM_IN: "zoomIn",
  ZOOM_OUT: "zoomOut",
  MODE: "mode",
  MODE_1: "mode1",
  MODE_2: "mode2",
  MODE_3: "mode3",
});

/**
 * How an action reacts to its button:
 * - HELD: active while held, auto-repeating (walk, zoom)
 * - LOOK: a direction of the continuous look / pan
 * - PRESS: once per press
 * - MODE_BUTTON: what the current mode assigns to it (see mode.js)
 */
export const ActionKind = Object.freeze({ HELD: "held", LOOK: "look", PRESS: "press", MODE_BUTTON: "modeButton" });

/**
 * @typedef {number | string | null} BindingValue  a button index, an axis binding (see binding.js) or unassigned
 * @typedef {{ id: string, label: string, kind: string }} ActionDef
 */

/** In the order the key mapping window lists them.
 * @type {readonly ActionDef[]} */
export const ACTIONS = Object.freeze([
  { id: Action.FORWARD, label: "Walk forward / pan north", kind: ActionKind.HELD },
  { id: Action.BACK, label: "Walk backward / pan south", kind: ActionKind.HELD },
  { id: Action.STRAFE_LEFT, label: "Step left (90° to the view)", kind: ActionKind.PRESS },
  { id: Action.STRAFE_RIGHT, label: "Step right (90° to the view)", kind: ActionKind.PRESS },
  { id: Action.LOOK_UP, label: "Look up", kind: ActionKind.LOOK },
  { id: Action.LOOK_DOWN, label: "Look down", kind: ActionKind.LOOK },
  { id: Action.LOOK_LEFT, label: "Look left / pan left", kind: ActionKind.LOOK },
  { id: Action.LOOK_RIGHT, label: "Look right / pan right", kind: ActionKind.LOOK },
  { id: Action.ZOOM_IN, label: "Zoom in", kind: ActionKind.HELD },
  { id: Action.ZOOM_OUT, label: "Zoom out", kind: ActionKind.HELD },
  { id: Action.MODE, label: "Select mode", kind: ActionKind.PRESS },
  { id: Action.MODE_1, label: "Mode button 1", kind: ActionKind.MODE_BUTTON },
  { id: Action.MODE_2, label: "Mode button 2", kind: ActionKind.MODE_BUTTON },
  { id: Action.MODE_3, label: "Mode button 3", kind: ActionKind.MODE_BUTTON },
]);

/** @param {string} kind */
export const actionsOfKind = (kind) => ACTIONS.filter((a) => a.kind === kind).map((a) => a.id);

/** The mode buttons in order: index 0 is mode button 1. */
export const MODE_BUTTONS = Object.freeze(actionsOfKind(ActionKind.MODE_BUTTON));

// Standard Gamepad mapping (https://w3c.github.io/gamepad/#remapping): face
// buttons 0 bottom, 1 right, 2 left, 3 top; 4/5 shoulder buttons, 6/7
// triggers, 8 select / back, 9 start, 12-15 D-pad up/down/left/right; axes 0/1
// the left stick. Face buttons go by position, so Y is the top one on both pads.
const XBOX = {
  [Action.FORWARD]: 4,
  [Action.BACK]: 0,
  [Action.STRAFE_LEFT]: 3,
  [Action.STRAFE_RIGHT]: 1,
  [Action.LOOK_UP]: "a1-",
  [Action.LOOK_DOWN]: "a1+",
  [Action.LOOK_LEFT]: "a0-",
  [Action.LOOK_RIGHT]: "a0+",
  [Action.ZOOM_IN]: 6,
  [Action.ZOOM_OUT]: 7,
  [Action.MODE]: 14,
  [Action.MODE_1]: 12,
  [Action.MODE_2]: 15,
  [Action.MODE_3]: 13,
};

const SNES = {
  [Action.FORWARD]: 3,
  [Action.BACK]: 0,
  [Action.STRAFE_LEFT]: null,
  [Action.STRAFE_RIGHT]: null,
  [Action.LOOK_UP]: 12,
  [Action.LOOK_DOWN]: 13,
  [Action.LOOK_LEFT]: 14,
  [Action.LOOK_RIGHT]: 15,
  [Action.ZOOM_IN]: 2,
  [Action.ZOOM_OUT]: 1,
  [Action.MODE]: 8,
  [Action.MODE_1]: 9,
  [Action.MODE_2]: 4,
  [Action.MODE_3]: 5,
};

/** The Xbox Classic preset of v1.10.0, before walk and step were corrected (#19). */
const XBOX_1_10 = { ...XBOX, [Action.FORWARD]: 3, [Action.STRAFE_LEFT]: 2 };

/** @typedef {{ id: string, label: string, map: Readonly<Record<string, BindingValue>> }} Preset */

/** The key mappings to start from; the first is the default.
 * @type {readonly Preset[]} */
export const PRESETS = Object.freeze([
  { id: "xbox", label: "Xbox Classic", map: Object.freeze(XBOX) },
  { id: "snes", label: "SNES", map: Object.freeze(SNES) },
]);

/** @param {string} [presetId] @returns {Record<string, BindingValue>} action id -> its binding in the preset */
export function presetButtonMap(presetId) {
  return { ...(PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]).map };
}

/** @returns {Record<string, BindingValue>} action id -> its default binding */
export const defaultButtonMap = () => presetButtonMap();

/** @param {Record<string, BindingValue>} map @param {Readonly<Record<string, BindingValue>>} preset */
const isExactly = (map, preset) => ACTIONS.every((a) => (map[a.id] ?? null) === preset[a.id]);

/** The preset a map is exactly, or null for a custom one. @param {Record<string, BindingValue>} map */
export const presetOf = (map) => PRESETS.find((p) => isExactly(map, p.map))?.id ?? null;

/**
 * A stored map completed with the defaults and cleaned of actions that no
 * longer exist. Maps from before the mode buttons (v1.10) bound actions that
 * are now mode commands, and keeping their bindings would clash with the new
 * defaults, so they start over from the default preset. So does a stored
 * copy of v1.10.0's Xbox Classic preset, which got walk and step wrong.
 * @param {Record<string, BindingValue> | undefined} stored @returns {Record<string, BindingValue>}
 */
export function normalizeButtonMap(stored) {
  const map = defaultButtonMap();
  if (!stored || !(Action.MODE_1 in stored) || isExactly(stored, XBOX_1_10)) return map;
  for (const a of ACTIONS) if (a.id in stored) map[a.id] = stored[a.id];
  return map;
}
