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
  const sceneCanvas = () =>
    document.querySelector("canvas.widget-scene-canvas") ||
    [...document.querySelectorAll("canvas")].sort(
      (a, b) => b.width * b.height - a.width * a.height
    )[0];

  // Street View vs. the normal map. Street View is driven with keys; the normal
  // map ignores synthetic keys until a real key has been pressed on the page,
  // so there buttons pan by dragging and zoom with the wheel instead.
  const isStreetView = () => /@[^/]*,\d+a,/.test(location.href);

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

  function sendWheel(deltaY) {
    const target = sceneCanvas();
    if (!target) return;
    const r = target.getBoundingClientRect();
    target.dispatchEvent(new WheelEvent("wheel", {
      deltaY, deltaMode: 0,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      bubbles: true, cancelable: true, composed: true, view: window,
    }));
  }

  // --- Held buttons -----------------------------------------------------------
  // A held button's action fires on press and then auto-repeats.
  const keyAction = (k) => ({
    down: (repeat) => sendKey("keydown", k, repeat),
    up: () => sendKey("keyup", k),
  });
  const wheelAction = (deltaY) => ({ down: () => sendWheel(deltaY), up: () => {} });

  const STREET_VIEW_ACTIONS = Object.fromEntries(
    Object.entries(KEY_BUTTONS).map(([idx, k]) => [idx, keyAction(k)])
  );
  // ABXY are handled as panning (see tick) on the map.
  const MAP_ACTIONS = {
    [BTN.LB]: wheelAction(100),
    [BTN.RB]: wheelAction(-100),
  };

  const held = new Map(); // button index -> { action, nextAt }

  function updateHeldButton(idx, action, pressed, now) {
    const state = held.get(idx);
    if (pressed && !state && action) {
      action.down(false);
      held.set(idx, { action, nextAt: now + KEY_REPEAT_DELAY });
    } else if (pressed && state && now >= state.nextAt) {
      state.action.down(true);
      state.nextAt = now + KEY_REPEAT_INTERVAL;
    } else if (!pressed && state) {
      state.action.up();
      held.delete(idx);
    }
  }

  function releaseAllKeys() {
    for (const [, state] of held) state.action.up();
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

  // Remembered for the tab so it survives the page reload a jump causes.
  const OVERLAY_KEY = "svgp-overlay-hidden";
  let overlayHidden = false;
  try { overlayHidden = sessionStorage.getItem(OVERLAY_KEY) === "1"; } catch {}

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
    try { sessionStorage.setItem(OVERLAY_KEY, overlayHidden ? "1" : ""); } catch {}
    applyOverlay();
    log("info", overlayHidden ? "search bar hidden" : "search bar shown");
  }

  // Maps re-renders these panels (e.g. a new title card after walking); keep
  // them hidden.
  setInterval(() => {
    if (overlayHidden) applyOverlay();
  }, 500);

  // --- Ambient sound ----------------------------------------------------------
  // Report the position in the URL (Street View location, or map centre) to the
  // background worker, which plays the nearest field recording. Positions are rounded to ~10 m so walking only
  // triggers a lookup per step, not per URL tweak.
  let ambientKey = ""; // "" = unknown, so the first check always reports

  function updateAmbient() {
    const m = location.href.match(/@(-?[\d.]+),(-?[\d.]+),/);
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

  // --- Jump to unconnected panoramas -----------------------------------------
  // User-contributed photospheres usually have no links to their neighbours, so
  // walking (Y/A) does nothing. If the panorama hasn't changed shortly after a
  // walk press, look for the nearest panorama roughly in the walking direction
  // and go there, asking first if it is far away.
  const JUMP_CHECK_DELAY = 1200; // ms after a walk press before we call it stuck
  const JUMP_CONFIRM_DISTANCE = 15; // m; farther jumps ask for confirmation
  const JUMP_MAX_ANGLE = 40; // ° a target may lie off the walking direction
  const JUMP_STEPS = [8, 16, 32, 64, 128, 256, 512, 1024, 2048]; // m ahead to search
  // Dialog buttons by position: top confirms, bottom aborts. Labelled with the
  // SNES-style names printed on those buttons (X top, B bottom).
  const JUMP_CONFIRM = { btn: BTN.Y, label: "X", color: "#3949ab" };
  const JUMP_ABORT = { btn: BTN.A, label: "B", color: "#f9a825" };

  // Pano id, position and view from a Street View URL like
  // /maps/@lat,lng,3a,75y,90h,90t/data=!3m...!1s<pano>!2e0...
  function currentPano() {
    const href = location.href;
    const at = href.match(/@(-?[\d.]+),(-?[\d.]+),[^/]*?(?:,([\d.]+)y)?,([\d.]+)h(?:,([\d.]+)t)?/);
    const id = href.match(/!1s([^!/?]+)!2e/);
    if (!at || !id) return null;
    return { id: decodeURIComponent(id[1]), lat: +at[1], lng: +at[2],
             fov: at[3] || "75", heading: +at[4], tilt: at[5] || "90" };
  }

  const R_EARTH = 6371000;
  const rad = Math.PI / 180;

  function offset(lat, lng, bearing, m) {
    return [lat + (m * Math.cos(bearing * rad)) / R_EARTH / rad,
            lng + (m * Math.sin(bearing * rad)) / (R_EARTH * Math.cos(lat * rad)) / rad];
  }

  function distBearing(lat1, lng1, lat2, lng2) {
    const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
    const y = (lat2 - lat1) * rad;
    return { m: R_EARTH * Math.hypot(x, y), bearing: (Math.atan2(x, y) / rad + 360) % 360 };
  }

  // The panorama (Google's or user-contributed) nearest to a point, via the
  // same endpoint the Maps web app uses. Same-origin, so no API key needed.
  async function searchPano(lat, lng, radius) {
    const pb = `!1m5!1sapiv3!5sUS!11m2!1m1!1b0!2m4!1m2!3d${lat}!4d${lng}!2d${Math.round(radius)}` +
      "!3m18!2m2!1sen!2sUS!9m1!1e2!11m12!1m3!1e2!2b1!3e2!1m3!1e3!2b1!3e2!1m3!1e10!2b1!3e2" +
      "!4m6!1e1!1e2!1e3!1e4!1e8!1e6";
    const res = await fetch(`/maps/photometa/si/v1?pb=${encodeURIComponent(pb)}`);
    if (!res.ok) throw new Error(`pano search: HTTP ${res.status}`);
    const r = JSON.parse((await res.text()).replace(/^\)\]\}'/, ""))[1];
    const pos = r?.[5]?.[0]?.[1]?.[0];
    if (!r?.[1]?.[1] || !pos) return null;
    return { type: r[1][0], id: r[1][1], lat: pos[2], lng: pos[3] };
  }

  // Search circles centred ever farther ahead, each about as wide as its
  // distance, and keep the nearest hit that lies in the walking direction.
  async function findPanoAhead(from, heading) {
    const hits = await Promise.all(JUMP_STEPS.map((d) => {
      const [lat, lng] = offset(from.lat, from.lng, heading, d);
      return searchPano(lat, lng, d * 0.6).catch((err) => (log("info", err), null));
    }));
    let best = null;
    for (const p of hits) {
      if (!p || p.id === from.id) continue;
      const { m, bearing } = distBearing(from.lat, from.lng, p.lat, p.lng);
      const off = Math.abs(((bearing - heading + 540) % 360) - 180);
      if (m < 1 || off > JUMP_MAX_ANGLE) continue;
      if (!best || m < best.m) best = { ...p, m };
    }
    return best;
  }

  function goToPano(p, from, heading) {
    // There is no public hook to switch panoramas in place, so load its URL.
    const data = p.type === 2
      ? `!3m4!1e1!3m2!1s${p.id}!2e0`
      : `!3m5!1e1!3m3!1s${p.id}!2e10!3e11`;
    location.assign(`${location.origin}/maps/@${p.lat},${p.lng},3a,${from.fov}y,` +
      `${heading.toFixed(2)}h,${from.tilt}t/data=${data}${location.search}`);
  }

  // On-screen message box, also used for the confirmation dialog.
  const box = document.createElement("div");
  box.style.cssText = `position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
    z-index: 2147483647; max-width: min(420px, 90vw); padding: 18px 22px; border-radius: 12px;
    background: rgba(20, 20, 20, .88); color: #fff; font: 16px/1.4 system-ui, sans-serif;
    text-align: center; box-shadow: 0 6px 24px rgba(0, 0, 0, .4); display: none;`;
  let boxTimer = 0;

  function showBox(html, ms = 0) {
    clearTimeout(boxTimer);
    box.innerHTML = html;
    box.style.display = "block";
    if (!box.isConnected) document.body.appendChild(box);
    if (ms) boxTimer = setTimeout(hideBox, ms);
  }

  function hideBox() {
    clearTimeout(boxTimer);
    box.style.display = "none";
  }

  const fmtDistance = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
  const KEYCAP = "display: inline-block; min-width: 1.4em; padding: 0 .3em; border-radius: 50%; font-weight: 700;";

  let jumpCheck = null; // { pano, at, back } – pending "did walking work?" check
  let jumpSearch = 0; // increments to invalidate a running search
  let searching = false;
  let jumpDialog = null; // { target, from, heading, okWas, noWas } while asking

  function cancelJump() {
    jumpCheck = null;
    jumpSearch++;
    if (jumpDialog || searching) hideBox();
    jumpDialog = null;
    searching = false;
  }

  async function startJumpSearch(back) {
    const from = currentPano();
    if (!from) return;
    const heading = (from.heading + (back ? 180 : 0)) % 360;
    const seq = ++jumpSearch;
    searching = true;
    showBox("Searching for the next Street View point…");
    const target = await findPanoAhead(from, heading);
    if (seq !== jumpSearch) return;
    searching = false;
    const now = currentPano();
    const turned = now && Math.abs(((now.heading - from.heading + 540) % 360) - 180) > JUMP_MAX_ANGLE;
    if (now?.id !== from.id || turned) return hideBox(); // moved or turned away meanwhile
    if (!target) {
      showBox("No Street View point found in this direction.", 2500);
      return;
    }
    log("info", `next point ${fmtDistance(target.m)} away:`, target.id);
    if (target.m <= JUMP_CONFIRM_DISTANCE) {
      hideBox();
      goToPano(target, from, heading);
      return;
    }
    jumpDialog = { target, from, heading, okWas: true, noWas: true };
    showBox(`Do you really want to go in this direction?<br>
      The next point is <b>${fmtDistance(target.m)}</b> away.<br><br>
      <span style="${KEYCAP} background: ${JUMP_CONFIRM.color}">${JUMP_CONFIRM.label}</span> confirm &nbsp;&nbsp;
      <span style="${KEYCAP} background: ${JUMP_ABORT.color}">${JUMP_ABORT.label}</span> abort`);
  }

  // Buttons that answered the dialog are ignored until released, so the
  // answer doesn't also walk.
  const swallowed = new Set();

  function confirmJump(ok) {
    const d = jumpDialog;
    cancelJump();
    swallowed.add(JUMP_CONFIRM.btn).add(JUMP_ABORT.btn);
    if (ok) goToPano(d.target, d.from, d.heading);
  }

  // While the dialog is open, the confirm/abort buttons answer it. Requires a
  // fresh press so a button already held when the dialog appears (e.g. the walk
  // button that triggered it) doesn't answer it.
  function updateJumpDialog(pressed) {
    const ok = pressed(JUMP_CONFIRM.btn), no = pressed(JUMP_ABORT.btn);
    if (ok && !jumpDialog.okWas) return confirmJump(true);
    if (no && !jumpDialog.noWas) return confirmJump(false);
    jumpDialog.okWas = ok;
    jumpDialog.noWas = no;
  }

  // Keyboard fallback: Enter confirms, Escape aborts.
  window.addEventListener("keydown", (e) => {
    if (!jumpDialog || !e.isTrusted) return;
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      confirmJump(e.key === "Enter");
    }
  }, true);

  // Called every tick in Street View. `edge` is "fwd"/"back" on a walk press,
  // `held` whether that walk button is still down. While held, every step to
  // a new panorama restarts the wait, so holding Y into a dead end works too.
  function updateJump(edge, held, now) {
    if (edge && !searching) {
      const pano = currentPano();
      jumpCheck = pano && { pano: pano.id, at: now + JUMP_CHECK_DELAY, back: edge === "back" };
    } else if (jumpCheck && held) {
      const id = currentPano()?.id;
      if (id && id !== jumpCheck.pano) Object.assign(jumpCheck, { pano: id, at: now + JUMP_CHECK_DELAY });
    }
    if (jumpCheck && now >= jumpCheck.at) {
      const { pano, back } = jumpCheck;
      jumpCheck = null;
      if (currentPano()?.id === pano) startJumpSearch(back);
    }
  }

  // --- Main loop ------------------------------------------------------------
  let startWasPressed = false;
  let selectWasPressed = false;
  let walkWasPressed = { fwd: false, back: false };
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
    log("debug", `${desc}  canvas=${!!sceneCanvas()}`);
  }

  // Polled on a timer rather than requestAnimationFrame: rAF depends on the
  // page producing frames and can drop to ~1/s (seen in headless Chrome), which
  // misses short button presses.
  function tick() {
    const now = performance.now();
    const dt = Math.min(now - lastFrame, 100); // clamp after tab stalls
    lastFrame = now;
    const pads = connectedPads();
    logButtons(pads);
    if (!pads.length || document.hidden) {
      releaseAllKeys();
      releaseLook();
      startWasPressed = selectWasPressed = false;
      walkWasPressed = { fwd: false, back: false };
    } else {
      const rawPressed = (i) => pads.some((gp) => gp.buttons[i]?.pressed);
      for (const i of swallowed) if (!rawPressed(i)) swallowed.delete(i);
      const pressed = (i) => rawPressed(i) && !swallowed.has(i);

      const streetView = isStreetView();
      if (!streetView) cancelJump();

      if (jumpDialog) {
        // The dialog owns the face buttons; nothing moves while it is open.
        releaseAllKeys();
        releaseLook();
        updateJumpDialog(pressed);
      } else {
        const actions = streetView ? STREET_VIEW_ACTIONS : MAP_ACTIONS;
        for (const idx of Object.keys(KEY_BUTTONS)) {
          updateHeldButton(Number(idx), actions[idx], pressed(Number(idx)), now);
        }

        // D-pad looks around (Street View) / pans (map); on the map ABXY pan too.
        const dir = (dpad, face) => pressed(dpad) || (!streetView && pressed(face));
        updateLook(
          (dir(BTN.RIGHT, BTN.B) ? 1 : 0) - (dir(BTN.LEFT, BTN.X) ? 1 : 0),
          (dir(BTN.DOWN, BTN.A) ? 1 : 0) - (dir(BTN.UP, BTN.Y) ? 1 : 0),
          dt
        );
      }

      const walk = { fwd: pressed(BTN.Y), back: pressed(BTN.A) };
      if (streetView && !jumpDialog) {
        const edge = walk.fwd && !walkWasPressed.fwd ? "fwd"
          : walk.back && !walkWasPressed.back ? "back" : null;
        updateJump(edge, jumpCheck?.back ? walk.back : walk.fwd, now);
      }
      walkWasPressed = walk;

      const start = pressed(BTN.START);
      if (start && !startWasPressed) {
        window.postMessage({ source: "sv-gamepad", type: "toggleFullscreen" }, "*");
      }
      startWasPressed = start;

      const select = pressed(BTN.SELECT);
      if (select && !selectWasPressed) toggleOverlay();
      selectWasPressed = select;
    }
  }

  window.addEventListener("gamepadconnected", (e) => log("info", "connected:", e.gamepad.id));
  window.addEventListener("gamepaddisconnected", (e) => log("info", "disconnected:", e.gamepad.id));
  setInterval(tick, 16);
})();
