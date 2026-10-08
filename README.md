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

## Install

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open Street View on Google Maps, press any gamepad button once so Chrome exposes the pad.

## Settings

Click the extension's toolbar icon to open the settings panel:

- **Horizontal / vertical look speed** – D-pad look speed per axis (px/s of simulated mouse drag; defaults 720 / 480).
- **Console log level** – `Off`, `Info` (gamepad connect/disconnect, Select toggles; default) or `Debug` (every button change, plus whether the tab is detected as Street View).

Changes apply immediately to open Street View tabs.

## Notes

- Only active on Street View URLs (`…/@lat,lng,<n>a,…`) and while the tab is visible.
- Key repeat rates are constants at the top of `inject.js`.
- Gamepad input doesn't count as a user gesture, so the page can't call `requestFullscreen()`.
  Instead, Start asks the background worker to put the browser window into fullscreen.
- Add more Google domains to `matches` in `manifest.json` if you use a different one.
