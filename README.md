# Street View Gamepad

Chrome extension (Manifest V3) that lets you control Google Street View — and the normal Google
Maps map — with a gamepad.

| Gamepad | Street View                                                      | Map               |
| ------- | ---------------------------------------------------------------- | ----------------- |
| Y / A   | walk forward / backward (jumps to unconnected points, see below) | pan north / south |
| X       | switch mode (see below)                                          | same              |
| B       | action of the current mode                                       | same              |
| D-pad   | look around / turn                                               | pan               |
| LB / RB | zoom out / in                                                    | zoom out / in     |
| Start   | toggle fullscreen (browser window)                               | same              |
| Select  | hide/show search bar + title card                                | same              |

Holding a button repeats its action.

These actions have no button by default; assign them in the key mapping window (see _Settings_):

| Action                            | What it does                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step left / right                 | jump to the nearest panorama 90° to the left / right of the view (±40°), keeping the view direction (Street View only)                                                  |
| One floor down                    | the opposite of B in floors mode; from the bottom floor it goes to the top one                                                                                          |
| Enlarge / shrink minimap          | clicks the button that enlarges Street View's minimap, or shrinks it again                                                                                              |
| Zoom minimap in / out             | scrolls the wheel over the minimap; repeats while held                                                                                                                  |
| Browser back / forward            | the browser's history                                                                                                                                                   |
| Next / previous Wikipedia article | goes through the (up to ten) articles nearby, wrapping around; a playing commentary switches to the new article. Outside commentary mode it first switches to that mode |

The minimap is found by its shape (a map canvas other than the scene, in the lower left) and its
enlarge button by its label (_Expand_, _Vergrößern_, …), or else as the button in its upper right
corner. Like the floor picker, this may stop working if Google changes its page; set the log level
to _Debug_ to see which buttons were found.

In Street View, buttons are sent as arrow and `+`/`-` keys and the D-pad as a mouse drag. The map
ignores synthetic key presses until a real key has been pressed on the page, so there the
extension pans with a simulated mouse drag and zooms with mouse-wheel events instead.

## Modes

The lower right corner shows the modes as icons, the current one highlighted with a short label.
The box is placed next to Google's own controls there (zoom, compass, floor picker,
attribution), never on top of them. It only shows while a gamepad is connected. The current
mode is remembered for the tab.

- **Floors** (layers icon): in places with several mapped floors, such as Tokyo Station, B goes
  one floor up, and from the top floor back to the bottom one. The icon is blue when there is a
  floor picker and gray otherwise; the label shows the current floor. Google's markup is
  obfuscated, so the picker is recognised by its shape: a vertical column of short labels like
  `B1`, `1`, `2F` in the right half of the screen. If Google changes it, this may stop working.
  Set the log level to _Debug_ to see what was found.
- **Audio commentary** (speaker icon): the icon turns orange when there is a Wikipedia article
  about a place within 500 m, and the label shows its title. B plays it, pauses it and resumes
  it. Nothing plays automatically. When several articles are nearby, the label numbers them
  (_Title (2/5)_) and the _next / previous article_ actions switch between them. If the article has a [Spoken
  Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_Spoken_Wikipedia) recording,
  you hear that person reading it. Otherwise a built-in voice reads the article's
  introduction (see _Text-to-speech_). Articles come from English Wikipedia, or else from the
  Wikipedia in your browser's language. Among the closest ten, longer articles win over slightly nearer ones, so the
  Brandenburg Gate beats the office next door. The ambient sound gets quieter while the
  commentary plays. A commentary keeps playing when you walk on or jump, and pauses when you
  switch tabs. If you've moved on to another article, B starts that one instead of resuming
  the old one.

## Unconnected panoramas

Google's own Street View images are linked to their neighbours, but user-contributed
photospheres usually aren't, so walking does nothing there. Whenever the view direction
changes, the extension looks up the nearest panorama, Google's or user-contributed, within ±40°
of the view direction, up to ~2 km ahead, and shows _"Next jump point xx m"_ centred at the
bottom of the screen (or _"No jump point in this direction"_).

If the panorama hasn't changed about a second after you press Y, the extension goes straight
to that point, without asking. A (backward) does the same for the opposite direction, searching
on demand. If nothing is found, a short message says so.

Holding Y walks normally and starts the search once you reach a dead end. A jump loads the
new panorama's URL, so the page reloads, which takes a moment. The search uses the same
unofficial endpoint the Maps web app uses (`/maps/photometa/si/v1`), so it may break if Google
changes it. Distances and angles are constants (`JUMP_*`) in `src/shared/config.js`.

If directions are open, the route on the Street View minimap is carried over to the new
panorama: the jump keeps the `/maps/dir/…` part of the URL and the route's blocks in its
`data=` part. The route is also remembered for the tab (session storage) in case the page after
the jump doesn't show it in its URL, and forgotten as soon as you close the directions or go
back to the map without them.

## Ambient sound

The extension plays the field recording made closest to the position in the Maps URL (your
Street View location, or the map centre), taken from [radio aporee ::: maps](https://aporee.org/maps/), an open global
sound map of ~70,000 field recordings. Walking to a spot where a different recording is nearest
crossfades to it. Sound pauses when you switch tabs or leave Google Maps.

- The list of recording locations (~1.8 MB) is downloaded once and cached for a week.
- The settings panel shows what's playing, who recorded it, how far away it was recorded, and its
  licence (mostly Creative Commons BY-NC-SA). Click the title to open it on aporee.org.
- aporee's JSON API is the one its map page uses and only answers requests coming from that page,
  so the extension sets that `Referer` on its own API requests (a `declarativeNetRequest` session
  rule limited to requests made by the extension).

## Text-to-speech

Most articles have no Spoken Wikipedia recording. Those are read aloud by
[Piper](https://github.com/rhasspy/piper), a neural voice that runs inside the extension (in the
offscreen document, via WebAssembly). Chrome's own speech isn't used because the Chromium snap has
no voices at all.

- The runtime ships with the extension in `vendor/`: ONNX Runtime Web 1.18.0 and the Piper/espeak-ng
  phonemizer from `@diffusionstudio/piper-wasm` 1.0.0, both MIT, ~11 MB together.
- Voices: `en_US-lessac-low`, and `de_DE-thorsten-low` for German articles. Each is ~60 MB and is
  downloaded from Hugging Face (`rhasspy/piper-voices`) the first time it's needed, together with
  espeak-ng's pronunciation data (~18 MB, jsDelivr). After that they come from the browser's cache,
  so it works offline. A message on screen shows the download progress.
- The voice loads as soon as commentary mode finds an article without a recording, so pressing B
  only waits for the first sentence (a few seconds). After that, sentences are synthesized while
  the previous one plays.
- These are the "low" quality voices. On a 2012 dual-core laptop (Pentium B960) they synthesize at
  about 0.7× real time. The "medium" ones need ~1.15× and would stutter. Voices are listed in
  `VOICES` in `src/infrastructure/audio/piper-synthesizer.js`.
- The extension pages allow `'wasm-unsafe-eval'` (see `manifest.json`), which WebAssembly needs.

## Install

**Without building:** download
[street-view-gamepad.zip](https://github.com/beyerl/street-view-gamepad/raw/main/release/street-view-gamepad.zip)
(`release/street-view-gamepad.zip` in this repository, the built extension).

1. Unzip it into a folder of its own.
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the unzipped folder.
4. Open Street View on Google Maps, press any gamepad button once so Chrome exposes the pad.

To update, replace the folder's contents with a newer zip and click the extension's reload
button in `chrome://extensions`.

**From the source:** the extension is built from `src/` into `dist/` (not committed), which
needs Node 22 or newer. Run `npm ci && npm run build`, then load this folder itself with **Load
unpacked**. After changing the code, run `npm run build` again (or keep `npm run watch`
running) and reload the extension.

## Settings

Click the extension's toolbar icon to open the settings panel:

- **Horizontal / vertical look speed** – D-pad look speed per axis (px/s of simulated mouse drag; defaults 720 / 480).
- **Ambient sound** on/off.
- **Master volume** scales the **soundscape volume** (ambient recordings) and the **commentary
  volume** (spoken articles). Changes apply immediately.
- **Configure gamepad keys…** opens a window that walks through every action ("Press a button
  for …", like Recalbox's input configuration) so you can reassign buttons. Enter skips an
  action, Esc cancels, and clicking an action remaps just that one. A button belongs to one
  action only; assigning it elsewhere unassigns it. The table at the top shows the defaults.
  Sticks and other axes can be assigned too, e.g. a Joy-Con's stick: moving an axis more than
  halfway from where it rested when configuring started assigns that direction (_Axis 1 −_),
  and the action is active while the axis is past halfway. Axes that rest at −1, like analogue
  triggers on some pads, count from there. A hat switch, which some systems report for a single
  Joy-Con's stick as one axis resting outside −1…1, is assigned per position
  (_Axis 9 = −1.00_).
- **Console log level** – `Off`, `Info` (gamepad connect/disconnect, Select toggles; default) or `Debug` (every button change).

Changes apply immediately to open Google Maps tabs.

## Notes

- Commentary uses the public Wikipedia and Wikimedia Commons APIs, looked up only in audio
  commentary mode and after moving 50 m. Spoken Wikipedia recordings and Wikipedia text are
  CC BY-SA.
- Active on all Google Maps pages (Street View and the normal map) while the tab is visible.
- The search bar hidden with Select stays hidden across page reloads in the same tab.
- Key repeat rates and all other tunables are constants in `src/shared/config.js`.
- Gamepad input doesn't count as a user gesture, so the page can't call `requestFullscreen()`.
  Instead, Start asks the background worker to put the browser window into fullscreen.
- Add more Google domains to `matches` in `manifest.json` if you use a different one.

## Development

| Command                           | What it does                                           |
| --------------------------------- | ------------------------------------------------------ |
| `npm run build` / `npm run watch` | bundle `src/entry/*-main.js` into `dist/` with esbuild |
| `npm test`                        | build, then run all tests (Node's test runner)         |
| `npm run test:coverage`           | the same with a coverage report for `src/`             |
| `npm run typecheck`               | check the JSDoc types with `tsc --checkJs`             |
| `npm run lint` / `npm run format` | ESLint / Prettier                                      |
| `npm run check`                   | everything CI runs                                     |

The _Tests_ GitHub Actions workflow (`.github/workflows/tests.yml`) runs `lint`, `format:check`,
`typecheck`, `test` and `package:check` (the committed zip matches the code; run
`npm run package` and commit the zip when it fails) on every pull request and push to `main`. Its `test` check is required by
the branch protection rule for `main`, so a pull request can't be merged while it fails.

## Architecture

The code is layered; dependencies only point inwards (see
[#7](https://github.com/beyerl/street-view-gamepad/issues/7) for the plan behind it).

```
src/
  domain/          pure logic, no browser or chrome APIs: geo maths, Maps URLs, actions and
                   bindings, settings, modes, floors, article ranking, commentary playback states
  application/     use cases, given everything they need through their constructors:
                   input controller, jumping, route keeping, modes, floors, minimap, overlay,
                   commentary and ambient sound (page side and background side), key mapping
  ports/           the interfaces the application layer depends on (abstract classes)
  infrastructure/  adapters implementing them: Google Maps' DOM (all page heuristics live in
                   google-maps-dom.js), synthetic input, the photometa / Wikipedia / aporee APIs,
                   message bus, storage, scheduler, offscreen audio, Piper text-to-speech
  presentation/    web components: the HUD, message box and hint on the Maps page (Shadow DOM),
                   the settings and key mapping components of the extension pages
  shared/          message types, storage keys and tunables, so there are no magic strings
  entry/           one composition root per context: page (MAIN world), bridge, background,
                   offscreen, popup, mapping. The only code that touches globals.
```

- **Dependency injection**: services get their collaborators as constructor arguments; the
  composition roots in `src/entry/` create the real ones, tests pass fakes.
- **Actions** are listed once, in `src/domain/actions.js` (id, label, kind, default button). The
  key mapping window, the defaults and the input controller all read that list. A new action
  needs an entry there and a command in `src/entry/page.js`.
- **Street View vs. map** controls are two strategies (`StreetViewControls`, `MapControls`).
- **Commentary playback** is a state machine (`Stopped`, `Playing`, `Paused`).
- The page's UI elements are custom elements with Shadow DOM, so Google's styles can't reach
  them. They are defined by the MAIN-world page script, because `customElements` doesn't
  exist in the isolated world of content scripts.

## Tests

Tests are under `test/`, laid out like `src/`. Domain and application code is tested directly
with fakes for its ports (`test/helpers/fakes.js`); code that builds or inspects markup runs on
[happy-dom](https://github.com/capricorn86/happy-dom) (`test/helpers/dom.js`). The tests in
`test/entry/` wire up each context as in the browser and check it end to end, and that the
manifest and pages only reference files that exist in the build.
