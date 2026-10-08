# Street View Gamepad

Chrome extension (Manifest V3) that lets you control Google Street View with a gamepad.

| Gamepad          | Action                         | Sent as                  |
|------------------|--------------------------------|--------------------------|
| Y / A            | walk forward / backward        | `ArrowUp` / `ArrowDown`  |
| X / B            | turn left / right              | `ArrowLeft` / `ArrowRight` |
| D-pad            | look around                    | simulated mouse drag     |
| LB / RB          | zoom out / in                  | `-` / `+`                |
| Start            | toggle fullscreen              | browser window fullscreen |
| Select           | hide/show search bar + title card | —                     |

Holding a button auto-repeats the key.

## Ambient sound

While you're in Street View, the extension plays the field recording made closest to your
current position, taken from [radio aporee ::: maps](https://aporee.org/maps/), an open global
sound map of ~70,000 field recordings. Walking to a spot where a different recording is nearest
crossfades to it. Sound pauses when you switch tabs or leave Street View.

- The list of recording locations (~1.8 MB) is downloaded once and cached for a week.
- The settings panel shows what's playing, who recorded it, how far away it was recorded, and its
  licence (mostly Creative Commons BY-NC-SA). Click the title to open it on aporee.org.
- aporee's JSON API is the one its map page uses and only answers requests coming from that page,
  so the extension sets that `Referer` on its own API requests (a `declarativeNetRequest` session
  rule limited to requests made by the extension).

## Install

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open Street View on Google Maps, press any gamepad button once so Chrome exposes the pad.

## Settings

Click the extension's toolbar icon to open the settings panel:

- **Horizontal / vertical look speed** – D-pad look speed per axis (px/s of simulated mouse drag; defaults 720 / 480).
- **Ambient sound** on/off and **volume**.
- **Console log level** – `Off`, `Info` (gamepad connect/disconnect, Select toggles; default) or `Debug` (every button change, plus whether the tab is detected as Street View).

Changes apply immediately to open Street View tabs.

## Notes

- Only active on Street View URLs (`…/@lat,lng,<n>a,…`) and while the tab is visible.
- Key repeat rates are constants at the top of `inject.js`.
- Gamepad input doesn't count as a user gesture, so the page can't call `requestFullscreen()`.
  Instead, Start asks the background worker to put the browser window into fullscreen.
- Add more Google domains to `matches` in `manifest.json` if you use a different one.
