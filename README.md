# Street View Gamepad

Chrome extension (Manifest V3) that lets you control Google Street View — and the normal Google
Maps map — with a gamepad.

| Gamepad   | Street View                    | Map                  |
|-----------|--------------------------------|----------------------|
| Y / A     | walk forward / backward (jumps to unconnected points, see below) | pan north / south    |
| X / B     | turn left / right              | pan west / east      |
| D-pad     | look around                    | pan                  |
| LB / RB   | zoom out / in                  | zoom out / in        |
| Start     | toggle fullscreen (browser window) | same             |
| Select    | hide/show search bar + title card  | same             |

Holding a button repeats its action.

In Street View, buttons are sent as arrow and `+`/`-` keys and the D-pad as a mouse drag. The map
ignores synthetic key presses until a real key has been pressed on the page, so there the
extension pans with a simulated mouse drag and zooms with mouse-wheel events instead.

## Unconnected panoramas

Google's own Street View images are linked to their neighbours, but user-contributed
photospheres usually aren't, so walking does nothing there. Whenever the view direction
changes, the extension looks up the nearest panorama, Google's or user-contributed, within ±40°
of the view direction, up to ~2 km ahead, and shows *"Next jump point xx m"* centred at the
bottom of the screen (or *"No jump point in this direction"*).

If the panorama hasn't changed about a second after you press Y, the extension goes straight
to that point, without asking. A (backward) does the same for the opposite direction, searching
on demand. If nothing is found, a short message says so.

Holding Y walks normally and starts the search once you reach a dead end. A jump loads the
new panorama's URL, so the page reloads, which takes a moment. The search uses the same
unofficial endpoint the Maps web app uses (`/maps/photometa/si/v1`), so it may break if Google
changes it. Distances and angles are constants (`JUMP_*`) in `inject.js`.

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
- The search bar hidden with Select stays hidden across page reloads in the same tab.
- Key repeat rates are constants at the top of `inject.js`.
- Gamepad input doesn't count as a user gesture, so the page can't call `requestFullscreen()`.
  Instead, Start asks the background worker to put the browser window into fullscreen.
- Add more Google domains to `matches` in `manifest.json` if you use a different one.
