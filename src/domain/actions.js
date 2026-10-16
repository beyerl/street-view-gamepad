// Everything a gamepad button (or axis) can be assigned to. The one list of
// actions: the key mapping window, the defaults and the input controller all
// read it.

/** Action ids. */
export const Action = Object.freeze({
  FORWARD: "forward",
  BACK: "back",
  LOOK_UP: "lookUp",
  LOOK_DOWN: "lookDown",
  LOOK_LEFT: "lookLeft",
  LOOK_RIGHT: "lookRight",
  ZOOM_IN: "zoomIn",
  ZOOM_OUT: "zoomOut",
  MODE: "mode",
  MODE_ACTION: "action",
  FULLSCREEN: "fullscreen",
  OVERLAY: "overlay",
  STRAFE_LEFT: "strafeLeft",
  STRAFE_RIGHT: "strafeRight",
  LEVEL_DOWN: "levelDown",
  MINIMAP_TOGGLE: "minimapToggle",
  MINIMAP_ZOOM_IN: "minimapZoomIn",
  MINIMAP_ZOOM_OUT: "minimapZoomOut",
  HISTORY_BACK: "historyBack",
  HISTORY_FORWARD: "historyForward",
  ARTICLE_NEXT: "articleNext",
  ARTICLE_PREV: "articlePrev",
});

/**
 * How an action reacts to its button:
 * - HELD: active while held, auto-repeating (walk, zoom)
 * - LOOK: a direction of the continuous look / pan
 * - PRESS: once per press
 */
export const ActionKind = Object.freeze({ HELD: "held", LOOK: "look", PRESS: "press" });

/**
 * @typedef {number | string | null} BindingValue  a button index, an axis binding (see binding.js) or unassigned
 * @typedef {{ id: string, label: string, kind: string, defaultBinding: BindingValue }} ActionDef
 */

/** In the order the key mapping window lists them. Default buttons follow the
 * Standard Gamepad mapping (https://w3c.github.io/gamepad/#remapping).
 * @type {readonly ActionDef[]} */
export const ACTIONS = Object.freeze([
  { id: Action.FORWARD, label: "Walk forward / pan north", kind: ActionKind.HELD, defaultBinding: 3 },
  { id: Action.BACK, label: "Walk backward / pan south", kind: ActionKind.HELD, defaultBinding: 0 },
  { id: Action.LOOK_UP, label: "Look up", kind: ActionKind.LOOK, defaultBinding: 12 },
  { id: Action.LOOK_DOWN, label: "Look down", kind: ActionKind.LOOK, defaultBinding: 13 },
  { id: Action.LOOK_LEFT, label: "Look left / pan left", kind: ActionKind.LOOK, defaultBinding: 14 },
  { id: Action.LOOK_RIGHT, label: "Look right / pan right", kind: ActionKind.LOOK, defaultBinding: 15 },
  { id: Action.ZOOM_IN, label: "Zoom in", kind: ActionKind.HELD, defaultBinding: 5 },
  { id: Action.ZOOM_OUT, label: "Zoom out", kind: ActionKind.HELD, defaultBinding: 4 },
  { id: Action.MODE, label: "Switch mode", kind: ActionKind.PRESS, defaultBinding: 2 },
  { id: Action.MODE_ACTION, label: "Action of current mode", kind: ActionKind.PRESS, defaultBinding: 1 },
  { id: Action.FULLSCREEN, label: "Toggle fullscreen", kind: ActionKind.PRESS, defaultBinding: 9 },
  { id: Action.OVERLAY, label: "Hide/show search bar + title card", kind: ActionKind.PRESS, defaultBinding: 8 },
  { id: Action.STRAFE_LEFT, label: "Step left (90° to the view)", kind: ActionKind.PRESS, defaultBinding: null },
  { id: Action.STRAFE_RIGHT, label: "Step right (90° to the view)", kind: ActionKind.PRESS, defaultBinding: null },
  { id: Action.LEVEL_DOWN, label: "One floor down", kind: ActionKind.PRESS, defaultBinding: null },
  { id: Action.MINIMAP_TOGGLE, label: "Enlarge / shrink minimap", kind: ActionKind.PRESS, defaultBinding: null },
  { id: Action.MINIMAP_ZOOM_IN, label: "Zoom minimap in", kind: ActionKind.HELD, defaultBinding: null },
  { id: Action.MINIMAP_ZOOM_OUT, label: "Zoom minimap out", kind: ActionKind.HELD, defaultBinding: null },
  { id: Action.HISTORY_BACK, label: "Browser back", kind: ActionKind.PRESS, defaultBinding: null },
  { id: Action.HISTORY_FORWARD, label: "Browser forward", kind: ActionKind.PRESS, defaultBinding: null },
  { id: Action.ARTICLE_NEXT, label: "Next Wikipedia article nearby", kind: ActionKind.PRESS, defaultBinding: null },
  { id: Action.ARTICLE_PREV, label: "Previous Wikipedia article nearby", kind: ActionKind.PRESS, defaultBinding: null },
]);

/** @returns {Record<string, BindingValue>} action id -> its default binding */
export function defaultButtonMap() {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, a.defaultBinding]));
}

/** @param {string} kind */
export const actionsOfKind = (kind) => ACTIONS.filter((a) => a.kind === kind).map((a) => a.id);
