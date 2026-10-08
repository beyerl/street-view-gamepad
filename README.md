# Street View Gamepad

Chrome extension (Manifest V3) that lets you control Google Street View — and the normal Google
Maps map — with a gamepad.

| Gamepad   | Street View                    | Map                  |
|-----------|--------------------------------|----------------------|
| Y / A     | walk forward / backward        | pan north / south    |
| X / B     | turn left / right              | pan west / east      |
| D-pad     | look around                    | pan                  |
| LB / RB   | zoom out / in                  | zoom out / in        |
| Start     | toggle fullscreen (browser window) | same             |
| Select    | hide/show search bar + title card  | same             |

Holding a button repeats its action.

In Street View, buttons are sent as arrow and `+`/`-` keys and the D-pad as a mouse drag. The map
ignores synthetic key presses until a real key has been pressed on the page, so there the
extension pans with a simulated mouse drag and zooms with mouse-wheel events instead.

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

## Install

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open Street View on Google Maps, press any gamepad button once so Chrome exposes the pad.

## Settings

Click the extension's toolbar icon to open the settings panel:

- **Horizontal / vertical look speed** – D-pad look speed per axis (px/s of simulated mouse drag; defaults 720 / 480).
- **Ambient sound** on/off and **volume**.
- **Console log level** – `Off`, `Info` (gamepad connect/disconnect, Select toggles; default) or `Debug` (every button change).

Changes apply immediately to open Google Maps tabs.

## Notes

- Active on all Google Maps pages (Street View and the normal map) while the tab is visible.
- Key repeat rates are constants at the top of `inject.js`.
- Gamepad input doesn't count as a user gesture, so the page can't call `requestFullscreen()`.
  Instead, Start asks the background worker to put the browser window into fullscreen.
- Add more Google domains to `matches` in `manifest.json` if you use a different one.
