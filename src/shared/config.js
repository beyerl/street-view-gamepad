// Tunables, in one place. Distances in metres, times in milliseconds.

// Input
export const TICK_INTERVAL = 16; // gamepad polling (a timer: rAF can drop to ~1/s)
export const KEY_REPEAT_DELAY = 350; // before a held button starts repeating
export const KEY_REPEAT_INTERVAL = 120; // between repeats while held
export const LOOK_REANCHOR = 250; // px: re-grab the view after dragging this far
export const MAX_FRAME = 100; // clamp the time step after the tab stalled
export const WHEEL_STEP = 100; // deltaY of one simulated wheel notch
export const AXIS_THRESHOLD = 0.5; // an axis past this counts as pressed
export const AXIS_RELEASE = 0.3; // and back within this as released (key mapping)
export const HAT_TOLERANCE = 0.1; // a hat switch's positions are 2/7 apart

// Jumping to unconnected panoramas
export const JUMP_CHECK_DELAY = 1200; // after a walk press before we call it stuck
export const JUMP_MAX_ANGLE = 40; // ° a target may lie off the walking direction
export const JUMP_STEPS = Object.freeze([8, 16, 32, 64, 128, 256, 512, 1024, 2048]); // m ahead to search
export const JUMP_SEARCH_WIDTH = 0.6; // search radius per step, relative to its distance
export const AHEAD_DELAY = 400; // the view must rest this long before looking up the point ahead
export const AHEAD_REUSE_ANGLE = 5; // ° the view may have turned and still use that lookup
export const AHEAD_POLL = 250;
export const ROUTE_POLL = 1000;

// Page
export const OVERLAY_POLL = 500; // Maps re-renders the panels we hide
export const AMBIENT_POLL = 1000;
export const COMMENTARY_POLL = 1000;
export const COMMENTARY_MOVE = 50; // to move before looking up the nearest article again
export const HUD_RENDER_POLL = 500;
export const HUD_PLACE_POLL = 1000;
export const HUD_MARGIN = 12; // px from the window edge / from Maps' controls
export const TOAST_SHORT = 1500;
export const TOAST_LONG = 2500;
export const LEVEL_RENDER_DELAY = 300; // after switching floors, before the HUD reads the new one

// Background
export const LOCATIONS_MAX_AGE = 7 * 24 * 3600 * 1000;
export const WIKI_RADIUS = 500; // around the position to look for an article
export const WIKI_LIMIT = 10; // articles to consider
export const WIKI_DISTANCE_BIAS = 100; // m added to distances when weighing length against distance
export const COMMONS_MAX_FILES = 20;
export const ERROR_NOTICE = 6000;

// Offscreen
export const FADE_MS = 1500;
export const FADE_STEP = 30;
export const DUCK = 0.25; // ambient volume factor while commentary plays
export const READ_AHEAD = 2; // sentences synthesized ahead of the one playing
export const READ_AHEAD_WAIT = 200;
