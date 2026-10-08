// Runs in the page's own JS world so the synthetic events (and the keyCode
// overrides on them) are seen exactly as Google Maps' handlers would see them.
(() => {
  "use strict";

  // --- Tunables -----------------------------------------------------------
  const KEY_REPEAT_DELAY = 350; // ms before a held button starts repeating
  const KEY_REPEAT_INTERVAL = 120; // ms between repeats while held
  const LOOK_REANCHOR = 250; // re-grab the view after dragging this far

  // Standard Gamepad mapping (https://w3c.github.io/gamepad/#remapping)
  const BTN = {
    A: 0, B: 1, X: 2, Y: 3,
    LB: 4, RB: 5,
    SELECT: 8, START: 9,
    UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
  };

  const KEYS = {
    up:    { key: "ArrowUp",    code: "ArrowUp",    keyCode: 38 },
    down:  { key: "ArrowDown",  code: "ArrowDown",  keyCode: 40 },
    left:  { key: "ArrowLeft",  code: "ArrowLeft",  keyCode: 37 },
    right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    zoomIn:  { key: "+", code: "Equal", keyCode: 187 },
    zoomOut: { key: "-", code: "Minus", keyCode: 189 },
  };

  // Buttons that act as held, auto-repeating keys. ABXY follow the diamond
  // layout of the face buttons: Y top, A bottom, X left, B right.
  const KEY_BUTTONS = {
    [BTN.Y]: KEYS.up,
    [BTN.A]: KEYS.down,
    [BTN.X]: KEYS.left,
    [BTN.B]: KEYS.right,
    [BTN.LB]: KEYS.zoomOut,
    [BTN.RB]: KEYS.zoomIn,
  };

  // User settings, pushed in from bridge.js (see settings.js for defaults).
  const settings = { lookSpeedX: 720, lookSpeedY: 480, logLevel: "info", soundEnabled: true };
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "sv-gamepad-bridge") return;
    if (e.data.type === "settings") Object.assign(settings, e.data.settings);
  });
  window.postMessage({ source: "sv-gamepad", type: "getSettings" }, "*");

  const LOG_LEVELS = { off: 0, info: 1, debug: 2 };
  const log = (level, ...args) => {
    if ((LOG_LEVELS[settings.logLevel] ?? 1) >= LOG_LEVELS[level])
      console.log("[Street View Gamepad]", ...args);
  };

  // --- Helpers ------------------------------------------------------------
  const isStreetView = () => /@[^/]*,\d+a,/.test(location.href);

  const sceneCanvas = () =>
    document.querySelector("canvas.widget-scene-canvas") ||
    [...document.querySelectorAll("canvas")].sort(
      (a, b) => b.width * b.height - a.width * a.height
    )[0];

  function sendKey(type, k, repeat = false) {
    const target = sceneCanvas() || document.body;
    const ev = new KeyboardEvent(type, {
      key: k.key, code: k.code, repeat,
      bubbles: true, cancelable: true, composed: true, view: window,
    });
    // Chrome ignores keyCode/which in the init dict; many handlers still use them.
    Object.defineProperty(ev, "keyCode", { get: () => k.keyCode });
    Object.defineProperty(ev, "which", { get: () => k.keyCode });
    target.dispatchEvent(ev);
  }

  function sendPointer(kind, x, y, buttons) {
    const target = sceneCanvas();
    if (!target) return;
    const common = {
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons,
      bubbles: true, cancelable: true, composed: true, view: window,
    };
    const pType = { down: "pointerdown", move: "pointermove", up: "pointerup" }[kind];
    const mType = { down: "mousedown", move: "mousemove", up: "mouseup" }[kind];
    target.dispatchEvent(
      new PointerEvent(pType, { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true })
    );
    // mousemove/mouseup are often listened for on document during a drag.
    (kind === "down" ? target : document).dispatchEvent(new MouseEvent(mType, common));
  }

  // --- Held-key state -------------------------------------------------------
  const held = new Map(); // button index -> { key, nextAt }

  function updateKeyButton(idx, pressed, now) {
    const k = KEY_BUTTONS[idx];
    const state = held.get(idx);
    if (pressed && !state) {
      sendKey("keydown", k);
      held.set(idx, { key: k, nextAt: now + KEY_REPEAT_DELAY });
    } else if (pressed && now >= state.nextAt) {
      sendKey("keydown", k, true);
      state.nextAt = now + KEY_REPEAT_INTERVAL;
    } else if (!pressed && state) {
      sendKey("keyup", k);
      held.delete(idx);
    }
  }

  function releaseAllKeys() {
    for (const [, state] of held) sendKey("keyup", state.key);
    held.clear();
  }

  // --- D-pad mouse-look -----------------------------------------------------
  let drag = null; // { x, y, ox, oy }

  function updateLook(dx, dy, dt) {
    if (!dx && !dy) {
      if (drag) {
        sendPointer("up", drag.x, drag.y, 0);
        drag = null;
      }
      return;
    }
    const canvas = sceneCanvas();
    if (!canvas) return;
    if (!drag) {
      const r = canvas.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      drag = { x, y, ox: x, oy: y };
      sendPointer("down", x, y, 1);
    }
    // Dragging moves the scene with the cursor, so drag opposite to the
    // direction we want to look.
    drag.x -= dx * settings.lookSpeedX * dt / 1000;
    drag.y -= dy * settings.lookSpeedY * dt / 1000;
    sendPointer("move", drag.x, drag.y, 1);

    // Keep the virtual cursor near the centre so it never leaves the canvas.
    if (Math.hypot(drag.x - drag.ox, drag.y - drag.oy) > LOOK_REANCHOR) {
      sendPointer("up", drag.x, drag.y, 0);
      drag = null;
    }
  }

  function releaseLook() {
    updateLook(0, 0, 0);
  }

  // --- Select: hide/show search bar + title card -----------------------------
  // Maps' class names are obfuscated and its layout varies (the title card is
  // sometimes inside the search panel, sometimes a separate box), so find them
  // by position: within the full-page overlay layer that holds the search
  // input, hide every floating element that sits entirely in the top-left
  // quarter of the page. A stylesheet with !important beats Maps' own inline
  // visibility styles.
  const HIDE_ATTR = "data-svgp-hidden";
  const style = document.createElement("style");
  style.textContent = `[${HIDE_ATTR}] { visibility: hidden !important; pointer-events: none !important; }`;
  document.documentElement.appendChild(style);

  let overlayHidden = false;

  function overlayLayer() {
    let el = document.querySelector("#searchboxinput, form input");
    while (el && el.getBoundingClientRect().width < window.innerWidth * 0.9) el = el.parentElement;
    return el;
  }

  function hideTopLeft(el, depth) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 &&
        r.right <= window.innerWidth / 2 && r.bottom <= window.innerHeight / 2) {
      el.setAttribute(HIDE_ATTR, "");
      return;
    }
    if (depth < 6) for (const c of el.children) hideTopLeft(c, depth + 1);
  }

  function applyOverlay() {
    if (!overlayHidden) {
      for (const el of document.querySelectorAll(`[${HIDE_ATTR}]`)) el.removeAttribute(HIDE_ATTR);
      return;
    }
    const layer = overlayLayer();
    if (!layer) return;
    for (const child of layer.children) {
      if (!child.querySelector("canvas")) hideTopLeft(child, 0);
    }
  }

  function toggleOverlay() {
    overlayHidden = !overlayHidden;
    applyOverlay();
    log("info", overlayHidden ? "search bar hidden" : "search bar shown");
  }

  // Maps re-renders these panels (e.g. a new title card after walking); keep
  // them hidden. Show them again when leaving Street View so the normal map
  // keeps its search bar.
  setInterval(() => {
    if (!overlayHidden) return;
    if (!isStreetView()) overlayHidden = false;
    applyOverlay();
  }, 500);

  // --- Ambient sound ----------------------------------------------------------
  // Report the Street View position to the background worker, which plays the
  // nearest field recording. Positions are rounded to ~10 m so walking only
  // triggers a lookup per step, not per URL tweak.
  let ambientKey = ""; // "" = unknown, so the first check always reports

  function updateAmbient() {
    const m = location.href.match(/@(-?[\d.]+),(-?[\d.]+),\d+a,/);
    if (settings.soundEnabled && m && !document.hidden) {
      const lat = +m[1], lng = +m[2];
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      if (key !== ambientKey) {
        ambientKey = key;
        window.postMessage({ source: "sv-gamepad", type: "ambient", lat, lng }, "*");
      }
    } else if (ambientKey !== null) {
      ambientKey = null;
      window.postMessage({ source: "sv-gamepad", type: "ambientStop" }, "*");
    }
  }

  setInterval(updateAmbient, 1000);
  document.addEventListener("visibilitychange", updateAmbient);
  updateAmbient();

  // --- Main loop ------------------------------------------------------------
  let startWasPressed = false;
  let selectWasPressed = false;
  let lastFrame = performance.now();

  const connectedPads = () =>
    [...navigator.getGamepads()].filter((gp) => gp && gp.connected);

  // Log button changes so it's visible in the console what the script sees.
  let lastPressedLog = "";
  function logButtons(pads) {
    const desc = pads
      .map((gp) => `pad ${gp.index}: [${gp.buttons.flatMap((b, i) => (b.pressed ? [i] : [])).join(",")}]`)
      .join("  ");
    if (desc === lastPressedLog) return;
    lastPressedLog = desc;
    log("debug", `${desc}  streetView=${isStreetView()} canvas=${!!sceneCanvas()}`);
  }

  function tick(now) {
    const dt = Math.min(now - lastFrame, 100); // clamp after tab stalls
    lastFrame = now;
    const pads = connectedPads();
    logButtons(pads);
    if (!pads.length || !isStreetView() || document.hidden) {
      releaseAllKeys();
      releaseLook();
      startWasPressed = selectWasPressed = false;
    } else {
      const pressed = (i) => pads.some((gp) => gp.buttons[i]?.pressed);

      for (const idx of Object.keys(KEY_BUTTONS)) {
        updateKeyButton(Number(idx), pressed(Number(idx)), now);
      }

      updateLook(
        (pressed(BTN.RIGHT) ? 1 : 0) - (pressed(BTN.LEFT) ? 1 : 0),
        (pressed(BTN.DOWN) ? 1 : 0) - (pressed(BTN.UP) ? 1 : 0),
        dt
      );

      const start = pressed(BTN.START);
      if (start && !startWasPressed) {
        window.postMessage({ source: "sv-gamepad", type: "toggleFullscreen" }, "*");
      }
      startWasPressed = start;

      const select = pressed(BTN.SELECT);
      if (select && !selectWasPressed) toggleOverlay();
      selectWasPressed = select;
    }
    requestAnimationFrame(tick);
  }

  window.addEventListener("gamepadconnected", (e) => log("info", "connected:", e.gamepad.id));
  window.addEventListener("gamepaddisconnected", (e) => log("info", "disconnected:", e.gamepad.id));
  requestAnimationFrame(tick);
})();
