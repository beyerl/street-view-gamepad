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

  // Buttons that act as held, auto-repeating keys: Y walks forward, A back.
  // Turning is left to the D-pad; X and B switch and use modes (see Modes).
  const KEY_BUTTONS = {
    [BTN.Y]: KEYS.up,
    [BTN.A]: KEYS.down,
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
  // Recognised by the "3a" view part of the URL, or by a panorama id
  // (!1s<id>!2e) in the data part: indoor panoramas with several floors don't
  // always carry the former. (!1e1 alone is the map's Street View coverage layer.)
  const isStreetView = () =>
    /@[^/]*,\d+(?:\.\d+)?a,/.test(location.href) ||
    /\/data=[^?#]*!1s[^!/?]+!2e\d/.test(location.href);

  let lastStreetView = null;
  function logStreetView(streetView) {
    if (streetView === lastStreetView) return;
    lastStreetView = streetView;
    log("debug", `${streetView ? "Street View" : "map"}: ${location.href}`);
  }

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
  // Y/A are handled as panning (see tick) on the map.
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
  // walking (Y/A) does nothing. Whenever the view direction changes, look up the
  // nearest panorama roughly ahead and show its distance at the bottom of the
  // screen. If the panorama hasn't changed shortly after a walk press, go there.
  const JUMP_CHECK_DELAY = 1200; // ms after a walk press before we call it stuck
  const JUMP_MAX_ANGLE = 40; // ° a target may lie off the walking direction
  const JUMP_STEPS = [8, 16, 32, 64, 128, 256, 512, 1024, 2048]; // m ahead to search
  const AHEAD_DELAY = 400; // ms the view must rest before looking up the point ahead
  const AHEAD_REUSE_ANGLE = 5; // ° the view may have turned and still use that lookup

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

  const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

  // On-screen message box for search progress and "nothing found".
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

  // Distance to the next point ahead, centred at the bottom of the screen.
  const hint = document.createElement("div");
  hint.style.cssText = `position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%);
    z-index: 2147483647; padding: 6px 14px; border-radius: 8px; pointer-events: none;
    background: rgba(20, 20, 20, .75); color: #fff; font: 15px/1.4 system-ui, sans-serif;
    white-space: nowrap; display: none;`;

  function showHint(text) {
    hint.textContent = text;
    hint.style.display = text ? "block" : "none";
    if (text && !hint.isConnected) document.body.appendChild(hint);
  }

  let ahead = null; // { pano, heading, target } – latest lookup for the view direction
  let aheadView = null; // { id, heading } the view a lookup was last started for
  let aheadTimer = 0;
  let aheadSearch = 0; // increments to invalidate a running lookup

  // Polled: start a lookup once the view has rested on a new panorama or heading.
  function updateAhead() {
    const p = isStreetView() && currentPano();
    if (!p) {
      clearTimeout(aheadTimer);
      aheadSearch++;
      ahead = aheadView = null;
      showHint("");
      return;
    }
    if (aheadView && aheadView.id === p.id && angleDiff(aheadView.heading, p.heading) < 1) return;
    aheadView = { id: p.id, heading: p.heading };
    clearTimeout(aheadTimer);
    aheadTimer = setTimeout(async () => {
      const seq = ++aheadSearch;
      const target = await findPanoAhead(p, p.heading);
      if (seq !== aheadSearch) return;
      ahead = { pano: p.id, heading: p.heading, target };
      showHint(target ? `Next jump point ${fmtDistance(target.m)}` : "No jump point in this direction");
    }, AHEAD_DELAY);
  }

  setInterval(updateAhead, 250);

  let jumpCheck = null; // { pano, at, back } – pending "did walking work?" check
  let jumpSearch = 0; // increments to invalidate a running search
  let searching = false;

  function cancelJump() {
    jumpCheck = null;
    jumpSearch++;
    if (searching) hideBox();
    searching = false;
  }

  // Go to the next point in the walking direction, reusing the lookup shown
  // in the hint when it still matches the view.
  async function startJumpSearch(back) {
    const from = currentPano();
    if (!from) return;
    const heading = (from.heading + (back ? 180 : 0)) % 360;
    let target;
    if (!back && ahead?.pano === from.id && angleDiff(ahead.heading, from.heading) <= AHEAD_REUSE_ANGLE) {
      target = ahead.target;
    } else {
      const seq = ++jumpSearch;
      searching = true;
      showBox("Searching for the next Street View point…");
      target = await findPanoAhead(from, heading);
      if (seq !== jumpSearch) return;
      searching = false;
      const now = currentPano();
      if (now?.id !== from.id || angleDiff(now.heading, from.heading) > JUMP_MAX_ANGLE) {
        return hideBox(); // moved or turned away meanwhile
      }
    }
    if (!target) {
      showBox("No Street View point found in this direction.", 2500);
      return;
    }
    log("info", `jumping ${fmtDistance(target.m)} to`, target.id);
    hideBox();
    goToPano(target, from, heading);
  }

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

  // --- Modes ------------------------------------------------------------------
  // X cycles through the modes, B performs the current mode's action. The modes
  // are shown in the lower right corner, placed clear of Maps' own controls.
  const MODES = ["levels", "commentary"];
  const MODE_KEY = "svgp-mode"; // per tab, survives the reload a jump causes
  let mode = MODES[0];
  try {
    const saved = sessionStorage.getItem(MODE_KEY);
    if (MODES.includes(saved)) mode = saved;
  } catch {}

  function nextMode() {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    try { sessionStorage.setItem(MODE_KEY, mode); } catch {}
    log("info", "mode:", mode);
    if (mode === "commentary") {
      commentaryPos = null;
      updateCommentaryLookup();
    }
    renderHud();
  }

  function modeAction() {
    if (mode === "levels") nextLevel();
    else if (mode === "commentary") toggleCommentary();
  }

  // --- Map levels -------------------------------------------------------------
  // Indoor places such as big stations have a floor picker: a vertical stack of
  // short labels ("B1", "1", "2F", …) near the right edge, highest floor on
  // top. Maps' markup is obfuscated, so find it by shape rather than by class.
  const LEVEL_RE = /^(?:-?\d{1,3}[A-Z]{0,2}|[A-Z]{1,2}-?\d{0,2}[A-Z]?)$/i;
  const LEVEL_SEL = 'button, [role="button"], [role="radio"], [role="option"], [role="menuitemradio"], [role="tab"]';
  let lastLevel = ""; // label we last switched to, if the picker doesn't mark the current one

  const visible = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true });

  function findLevelPicker() {
    const cands = [];
    for (const el of document.querySelectorAll(LEVEL_SEL)) {
      if (hud.contains(el) || el.querySelector(LEVEL_SEL)) continue; // innermost only
      const label = el.textContent.trim();
      if (!LEVEL_RE.test(label) || /^3D$/i.test(label)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.left < window.innerWidth / 2 || !visible(el)) continue;
      cands.push({ el, label, x: r.left + r.width / 2, y: r.top });
    }
    // Cluster by horizontal centre; the biggest column of 2+ is the picker.
    let best = [];
    for (const c of cands) {
      const col = cands.filter((o) => Math.abs(o.x - c.x) < 8);
      if (col.length > best.length) best = col;
    }
    if (best.length < 2) return null;
    const items = best.sort((a, b) => a.y - b.y); // top (highest floor) first
    return { items, current: currentLevel(items) };
  }

  function currentLevel(items) {
    const ATTRS = ["aria-checked", "aria-pressed", "aria-selected"];
    const isOn = (e) =>
      ATTRS.some((a) => e.getAttribute(a) === "true") ||
      (e.hasAttribute("aria-current") && e.getAttribute("aria-current") !== "false");
    let i = items.findIndex(({ el }) => isOn(el) || isOn(el.parentElement) || [...el.querySelectorAll("*")].some(isOn));
    if (i >= 0) return i;
    // Otherwise the selected one is usually the only one styled differently.
    if (items.length >= 3) {
      const sig = items.map(({ el }) => {
        const cs = getComputedStyle(el);
        return `${cs.color}|${cs.backgroundColor}|${cs.fontWeight}`;
      });
      const odd = sig.filter((s) => sig.indexOf(s) === sig.lastIndexOf(s));
      if (odd.length === 1) return sig.indexOf(odd[0]);
    }
    return items.findIndex((it) => it.label === lastLevel);
  }

  function clickElement(el) {
    const r = el.getBoundingClientRect();
    const common = {
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0,
      bubbles: true, cancelable: true, composed: true, view: window,
    };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...common, buttons: 1, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...common, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...common, buttons: 0, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...common, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...common, buttons: 0 }));
  }

  // One floor up; from the top floor (or an unknown one) start at the bottom.
  function nextLevel() {
    const picker = findLevelPicker();
    if (!picker) {
      showBox("No floors to switch between here.", 1500);
      return;
    }
    const { items, current } = picker;
    const target = current > 0 ? items[current - 1] : items[items.length - 1];
    log("debug", `levels [${items.map((it) => it.label)}], current ${items[current]?.label ?? "?"} -> ${target.label}`);
    lastLevel = target.label;
    clickElement(target.el);
    setTimeout(renderHud, 300);
  }

  // --- Audio commentary -------------------------------------------------------
  // The background worker finds the Wikipedia article nearest to the position
  // and plays its Spoken Wikipedia recording, or reads its introduction aloud.
  // Nothing plays until B is pressed.
  const COMMENTARY_MOVE = 50; // m to move before looking up the nearest article again
  let commentary = { available: false, title: "", status: "stopped", playingTitle: "" };
  let commentaryPos = null; // where the last lookup was made

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "sv-gamepad-bridge") return;
    if (e.data.type === "commentary") {
      commentary = e.data.state;
      renderHud();
    } else if (e.data.type === "commentaryNotice") {
      if (e.data.message) showBox(e.data.message, e.data.ms);
      else hideBox();
    }
  });

  function updateCommentaryLookup() {
    if (mode !== "commentary" || document.hidden) return;
    const m = location.href.match(/@(-?[\d.]+),(-?[\d.]+),/);
    if (!m) return;
    const lat = +m[1], lng = +m[2];
    if (commentaryPos && distBearing(commentaryPos.lat, commentaryPos.lng, lat, lng).m < COMMENTARY_MOVE) return;
    commentaryPos = { lat, lng };
    window.postMessage({ source: "sv-gamepad", type: "commentaryAt", lat, lng }, "*");
  }

  function toggleCommentary() {
    if (!commentary.available && commentary.status === "stopped") {
      showBox("No commentary for this place.", 1500);
      return;
    }
    window.postMessage({ source: "sv-gamepad", type: "commentaryToggle" }, "*");
  }

  setInterval(updateCommentaryLookup, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) window.postMessage({ source: "sv-gamepad", type: "commentaryPause" }, "*");
    else updateCommentaryLookup();
  });

  // --- Mode display -----------------------------------------------------------
  const ICONS = {
    // Material "layers" and "volume_up"
    levels: '<svg viewBox="0 0 24 24"><path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/></svg>',
    commentary: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
  };
  const HUD_MARGIN = 12; // px from the window edge / from Maps' controls

  style.textContent += `
    #svgp-hud { position: fixed; right: ${HUD_MARGIN}px; bottom: ${HUD_MARGIN}px; z-index: 2147483646;
      display: flex; gap: 4px; padding: 4px; border-radius: 10px; pointer-events: none;
      background: rgba(20, 20, 20, .78); font: 13px/1 system-ui, sans-serif; color: #fff; }
    #svgp-hud .m { display: flex; align-items: center; gap: 6px; padding: 5px 7px; border-radius: 7px;
      color: #80868b; opacity: .6; }
    #svgp-hud .m.active { opacity: 1; background: rgba(255, 255, 255, .16); }
    #svgp-hud .m.on[data-mode=levels] { color: #4fc3f7; }
    #svgp-hud .m.on[data-mode=commentary] { color: #ffb74d; }
    #svgp-hud .m.playing svg { animation: svgp-pulse 1.2s ease-in-out infinite; }
    #svgp-hud svg { width: 20px; height: 20px; fill: currentColor; }
    #svgp-hud span { color: #fff; max-width: 16em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #svgp-hud .m:not(.active) span, #svgp-hud span:empty { display: none; }
    @keyframes svgp-pulse { 50% { opacity: .4; } }`;

  const hud = document.createElement("div");
  hud.id = "svgp-hud";
  hud.innerHTML = MODES.map((m) => `<div class="m" data-mode="${m}">${ICONS[m]}<span></span></div>`).join("");
  const chip = Object.fromEntries(MODES.map((m) => [m, hud.querySelector(`[data-mode=${m}]`)]));

  function renderHud() {
    const show = connectedPads().length > 0;
    hud.style.display = show ? "flex" : "none";
    if (!show) return;
    if (!hud.isConnected) document.body.appendChild(hud);
    for (const m of MODES) chip[m].classList.toggle("active", m === mode);

    const picker = findLevelPicker();
    chip.levels.classList.toggle("on", !!picker);
    chip.levels.querySelector("span").textContent =
      picker ? `Floor ${picker.items[picker.current]?.label ?? "?"}` : "No floors here";

    const c = commentary;
    chip.commentary.classList.toggle("on", c.available || c.status !== "stopped");
    chip.commentary.classList.toggle("playing", c.status === "playing");
    chip.commentary.querySelector("span").textContent =
      c.status === "playing" ? c.playingTitle
      : c.status === "paused" ? `⏸ ${c.playingTitle}`
      : c.available ? c.title : "Nothing nearby";
  }

  // Maps' own controls in the lower part of the screen (zoom, compass, floor
  // picker, attribution, …): leaf elements that actually paint something, plus
  // controls and images. Big layers like the scene canvas don't count.
  function obstacles() {
    const W = window.innerWidth, H = window.innerHeight;
    const out = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (hud.contains(el)) continue;
      const control = /^(BUTTON|A|INPUT|IMG|CANVAS|svg|VIDEO)$/.test(el.tagName);
      if (el.childElementCount && !control) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.right < W / 3 || r.bottom < H / 2 || r.width * r.height > W * H / 4) continue;
      if (!visible(el)) continue;
      if (!control && !el.textContent.trim()) {
        const cs = getComputedStyle(el);
        const paints = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" ||
          cs.borderStyle !== "none" || cs.boxShadow !== "none";
        if (!paints) continue;
      }
      out.push(r);
    }
    return out;
  }

  // Closest spot to the corner that is clear of every obstacle: try each
  // combination of "flush with the edge" and "just left of / above an obstacle".
  function placeHud() {
    if (hud.style.display === "none" || !hud.isConnected) return;
    const W = window.innerWidth, H = window.innerHeight;
    const { width: w, height: h } = hud.getBoundingClientRect();
    const obs = obstacles();
    const rights = [HUD_MARGIN, ...obs.map((r) => W - r.left + HUD_MARGIN / 2)];
    const bottoms = [HUD_MARGIN, ...obs.map((r) => H - r.top + HUD_MARGIN / 2)];
    let best = null;
    for (const right of rights) {
      for (const bottom of bottoms) {
        const l = W - right - w, t = H - bottom - h, rr = W - right, b = H - bottom;
        if (l < W / 3 || t < H / 2) continue;
        if (obs.some((o) => o.left < rr + 2 && o.right > l - 2 && o.top < b + 2 && o.bottom > t - 2)) continue;
        if (!best || right + bottom < best.right + best.bottom) best = { right, bottom };
      }
    }
    best ||= { right: HUD_MARGIN, bottom: HUD_MARGIN };
    hud.style.right = `${best.right}px`;
    hud.style.bottom = `${best.bottom}px`;
  }

  setInterval(renderHud, 500);
  setInterval(placeHud, 1000);

  // --- Main loop ------------------------------------------------------------
  let startWasPressed = false;
  let selectWasPressed = false;
  let modeWasPressed = false;
  let actionWasPressed = false;
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
      startWasPressed = selectWasPressed = modeWasPressed = actionWasPressed = false;
      walkWasPressed = { fwd: false, back: false };
    } else {
      const pressed = (i) => pads.some((gp) => gp.buttons[i]?.pressed);

      const streetView = isStreetView();
      logStreetView(streetView);
      if (!streetView) cancelJump();

      const actions = streetView ? STREET_VIEW_ACTIONS : MAP_ACTIONS;
      for (const idx of Object.keys(KEY_BUTTONS)) {
        updateHeldButton(Number(idx), actions[idx], pressed(Number(idx)), now);
      }

      // D-pad looks around (Street View) / pans (map); on the map Y/A pan too.
      const dir = (dpad, face) => pressed(dpad) || (!streetView && pressed(face));
      updateLook(
        (pressed(BTN.RIGHT) ? 1 : 0) - (pressed(BTN.LEFT) ? 1 : 0),
        (dir(BTN.DOWN, BTN.A) ? 1 : 0) - (dir(BTN.UP, BTN.Y) ? 1 : 0),
        dt
      );

      const walk = { fwd: pressed(BTN.Y), back: pressed(BTN.A) };
      if (streetView) {
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

      const modeBtn = pressed(BTN.X);
      if (modeBtn && !modeWasPressed) nextMode();
      modeWasPressed = modeBtn;

      const actionBtn = pressed(BTN.B);
      if (actionBtn && !actionWasPressed) modeAction();
      actionWasPressed = actionBtn;
    }
  }

  window.addEventListener("gamepadconnected", (e) => log("info", "connected:", e.gamepad.id));
  window.addEventListener("gamepaddisconnected", (e) => log("info", "disconnected:", e.gamepad.id));
  setInterval(tick, 16);
})();
