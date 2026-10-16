// Shared by the popup, the key mapping window, bridge.js and background.js. Look speeds are
// px/second of simulated mouse drag while a look button is held.
// buttonMap: action -> button index in the Standard Gamepad mapping
// (https://w3c.github.io/gamepad/#remapping). Keep in sync with DEFAULT_BUTTON_MAP in inject.js.
const SVG_DEFAULTS = {
  lookSpeedX: 720,
  lookSpeedY: 480,
  logLevel: "info", // "off" | "info" | "debug"
  soundEnabled: true, // ambient field recording nearest to the location
  masterVolume: 100, // 0-100, scales both of the following
  volume: 50, // 0-100, soundscape (ambient recordings)
  commentaryVolume: 100, // 0-100, spoken articles
  buttonMap: {
    forward: 3, back: 0, zoomOut: 4, zoomIn: 5,
    lookUp: 12, lookDown: 13, lookLeft: 14, lookRight: 15,
    mode: 2, action: 1, fullscreen: 9, overlay: 8,
    // No default buttons for these.
    strafeLeft: null, strafeRight: null, levelDown: null,
    minimapToggle: null, minimapZoomIn: null, minimapZoomOut: null,
    historyBack: null, historyForward: null, articleNext: null, articlePrev: null,
  },
};

// Actions shown in the key mapping window, in order.
const SVG_ACTIONS = [
  { id: "forward", label: "Walk forward / pan north" },
  { id: "back", label: "Walk backward / pan south" },
  { id: "lookUp", label: "Look up" },
  { id: "lookDown", label: "Look down" },
  { id: "lookLeft", label: "Look left / pan left" },
  { id: "lookRight", label: "Look right / pan right" },
  { id: "zoomIn", label: "Zoom in" },
  { id: "zoomOut", label: "Zoom out" },
  { id: "mode", label: "Switch mode" },
  { id: "action", label: "Action of current mode" },
  { id: "fullscreen", label: "Toggle fullscreen" },
  { id: "overlay", label: "Hide/show search bar + title card" },
  { id: "strafeLeft", label: "Step left (90° to the view)" },
  { id: "strafeRight", label: "Step right (90° to the view)" },
  { id: "levelDown", label: "One floor down" },
  { id: "minimapToggle", label: "Enlarge / shrink minimap" },
  { id: "minimapZoomIn", label: "Zoom minimap in" },
  { id: "minimapZoomOut", label: "Zoom minimap out" },
  { id: "historyBack", label: "Browser back" },
  { id: "historyForward", label: "Browser forward" },
  { id: "articleNext", label: "Next Wikipedia article nearby" },
  { id: "articlePrev", label: "Previous Wikipedia article nearby" },
];
