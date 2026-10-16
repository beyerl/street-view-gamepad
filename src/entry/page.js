// Composition root of the page script. Runs in the page's own JS world (MAIN)
// so the synthetic events, and the keyCode overrides on them, are seen exactly
// as Google Maps' handlers would see them. The only place that touches
// browser globals; everything else gets what it needs passed in.

import { Action } from "../domain/actions.js";
import { LevelStep } from "../domain/levels.js";
import { Mode } from "../domain/mode.js";
import { MapsUrl } from "../domain/maps-url.js";
import { withDefaults } from "../domain/settings.js";
import { AmbientReporter } from "../application/ambient-reporter.js";
import { CommentaryClient } from "../application/commentary-client.js";
import { InputController } from "../application/input-controller.js";
import { JumpService, Turn } from "../application/jump-service.js";
import { LevelService } from "../application/level-service.js";
import { MinimapService } from "../application/minimap-service.js";
import { ModeService } from "../application/mode-service.js";
import { OverlayService } from "../application/overlay-service.js";
import { RouteKeeper } from "../application/route-keeper.js";
import { LocationNavigator, GamepadInput } from "../infrastructure/browser.js";
import { GoogleMapsDom } from "../infrastructure/google-maps-dom.js";
import { makeLogger } from "../infrastructure/logger.js";
import { PhotometaPanoramaRepository } from "../infrastructure/photometa-panorama-repository.js";
import { TickScheduler } from "../infrastructure/scheduler.js";
import { SessionStore } from "../infrastructure/session-store.js";
import { DragLook, MapControls, SceneInput, StreetViewControls } from "../infrastructure/view-controls.js";
import { WindowMessageBus } from "../infrastructure/window-message-bus.js";
import { defineComponents } from "../presentation/components.js";
import { HintView, HudView, ToastView } from "../presentation/views.js";
import * as config from "../shared/config.js";
import { Msg, Source } from "../shared/messages.js";

/**
 * Wires up and starts the page script.
 * @param {typeof globalThis & Window} g the page's global object (a stand-in in tests)
 */
export function startPage(g) {
  const { document, window } = g;
  const settings = withDefaults();
  const log = makeLogger(g.console, () => settings.logLevel);
  const events = {
    KeyboardEvent: g.KeyboardEvent,
    PointerEvent: g.PointerEvent,
    MouseEvent: g.MouseEvent,
    WheelEvent: g.WheelEvent,
  };
  const scheduler = new TickScheduler(
    {
      setInterval: g.setInterval.bind(g),
      setTimeout: g.setTimeout.bind(g),
      clearTimeout: g.clearTimeout.bind(g),
      now: () => g.performance.now(),
    },
    config.TICK_INTERVAL,
  );
  const store = new SessionStore(() => g.sessionStorage);
  const navigator = new LocationNavigator(g.location, g.history);
  const bus = new WindowMessageBus(window, { send: Source.PAGE, accept: Source.BRIDGE });
  const isHidden = () => document.hidden;
  const isStreetView = () => new MapsUrl(navigator.href).isStreetView;

  defineComponents(g);
  const dom = new GoogleMapsDom({ document, window, getComputedStyle: g.getComputedStyle.bind(g), events, log });
  const toast = new ToastView(document, scheduler);
  const hint = new HintView(document);
  const hud = new HudView(document, window, dom);
  dom.ownElements.add(hud.el).add(toast.el).add(hint.el);

  bus.on(Msg.SETTINGS, (msg) => Object.assign(settings, withDefaults(msg.settings)));
  bus.post(Msg.GET_SETTINGS);

  const input = new GamepadInput(g.navigator);
  const modes = new ModeService(store, log);
  const overlay = new OverlayService(dom, store, log);
  const routes = new RouteKeeper(store, navigator, log);
  const panoramas = new PhotometaPanoramaRepository((url) => g.fetch(url));
  const jump = new JumpService({ panoramas, navigator, routes, scheduler, toast, hint, log });
  const renderHud = () =>
    hud.render(input.pads().length > 0, { mode: modes.mode, floor: levels.floor(), commentary: commentary.state });
  const levels = new LevelService({ page: dom, toast, scheduler, onSwitched: renderHud, log });
  const minimap = new MinimapService(dom, toast);
  const commentary = new CommentaryClient({ bus, navigator, modes, toast, isHidden, onChange: renderHud });
  const ambient = new AmbientReporter({ bus, navigator, settings, isHidden });
  modes.onChange(renderHud);

  /** What each press action does. */
  const commands = {
    [Action.MODE]: () => modes.next(),
    [Action.MODE_ACTION]: () => (modes.mode === Mode.COMMENTARY ? commentary.toggle() : levels.switch(LevelStep.UP)),
    [Action.FULLSCREEN]: () => bus.post(Msg.TOGGLE_FULLSCREEN),
    [Action.OVERLAY]: () => overlay.toggle(),
    [Action.STRAFE_LEFT]: () => jump.strafe(Turn.LEFT),
    [Action.STRAFE_RIGHT]: () => jump.strafe(Turn.RIGHT),
    [Action.LEVEL_DOWN]: () => levels.switch(LevelStep.DOWN),
    [Action.MINIMAP_TOGGLE]: () => minimap.toggle(),
    [Action.HISTORY_BACK]: () => navigator.back(),
    [Action.HISTORY_FORWARD]: () => navigator.forward(),
    [Action.ARTICLE_NEXT]: () => commentary.next(1),
    [Action.ARTICLE_PREV]: () => commentary.next(-1),
  };

  const scene = new SceneInput({ dom, document, window, events });
  const look = new DragLook(scene, dom, settings);
  const controller = new InputController({
    input,
    settings,
    isHidden,
    isStreetView,
    streetView: new StreetViewControls(scene, look, dom),
    map: new MapControls(scene, look),
    jump,
    commands,
    now: () => scheduler.now(),
    log,
  });

  scheduler.every(config.TICK_INTERVAL, () => controller.tick());
  scheduler.every(config.OVERLAY_POLL, () => overlay.refresh());
  scheduler.every(config.AMBIENT_POLL, () => ambient.update());
  scheduler.every(config.AHEAD_POLL, () => jump.updateAhead());
  scheduler.every(config.ROUTE_POLL, () => routes.update());
  scheduler.every(config.COMMENTARY_POLL, () => commentary.lookup());
  scheduler.every(config.HUD_RENDER_POLL, renderHud);
  scheduler.every(config.HUD_PLACE_POLL, () => hud.place());

  document.addEventListener("visibilitychange", () => {
    ambient.update();
    if (document.hidden) commentary.pause();
    else commentary.lookup();
  });
  window.addEventListener("gamepadconnected", (e) =>
    log("info", "connected:", /** @type {GamepadEvent} */ (e).gamepad.id),
  );
  window.addEventListener("gamepaddisconnected", (e) =>
    log("info", "disconnected:", /** @type {GamepadEvent} */ (e).gamepad.id),
  );
  ambient.update();
  routes.update();

  return { settings, modes, jump, routes, commentary, levels, overlay, controller, hud, toast, hint, scheduler };
}
