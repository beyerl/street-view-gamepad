// Shared by the popup, bridge.js and background.js. Look speeds are px/second of simulated
// mouse drag while the D-pad is held.
const SVG_DEFAULTS = {
  lookSpeedX: 720,
  lookSpeedY: 480,
  logLevel: "info", // "off" | "info" | "debug"
  soundEnabled: true, // ambient field recording nearest to the location
  masterVolume: 100, // 0-100, scales both of the following
  volume: 50, // 0-100, soundscape (ambient recordings)
  commentaryVolume: 100, // 0-100, spoken articles
};
