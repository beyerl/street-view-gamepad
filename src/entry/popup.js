// Composition root of the settings popup.

import { DEFAULT_SETTINGS, withDefaults } from "../domain/settings.js";
import { StorageKey } from "../shared/storage-keys.js";
import { defineSettingsComponents, SETTING_CHANGE, SettingTag } from "../presentation/settings-components.js";

export const MAPPING_WINDOW = Object.freeze({ url: "mapping.html", type: "popup", width: 520, height: 900 });

/** @param {any} g */
export function startPopup(g) {
  const { document, chrome } = g;
  defineSettingsComponents(g);
  const settings = () => /** @type {any[]} */ ([...document.querySelectorAll(SettingTag.SETTING)]);

  /** @param {Record<string, any>} values */
  const show = (values) => {
    for (const el of settings()) el.value = values[el.key];
  };

  document.addEventListener(SETTING_CHANGE, (/** @type {CustomEvent} */ e) =>
    chrome.storage.sync.set({ [e.detail.key]: e.detail.value }),
  );

  document.getElementById("mapping").addEventListener("click", () => {
    chrome.windows.create({ ...MAPPING_WINDOW });
    g.close();
  });

  document.getElementById("reset").addEventListener("click", async () => {
    await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, buttonMap: { ...DEFAULT_SETTINGS.buttonMap } });
    show(DEFAULT_SETTINGS);
  });

  // Attribution for the current recording (radio aporee ::: maps, mostly CC licensed).
  const showNowPlaying = (/** @type {any} */ np) => {
    const box = document.getElementById("nowPlaying");
    box.hidden = !np;
    if (!np) return;
    const title = document.getElementById("np-title");
    title.textContent = np.title || np.place;
    title.href = np.link;
    document.getElementById("np-meta").textContent =
      `${np.place} · ${np.km} km away · by ${np.artist}, ${np.recdate} · ${np.licence} · radio aporee ::: maps`;
  };

  const ready = Promise.all([
    chrome.storage.sync.get(null).then((/** @type {any} */ s) => show(withDefaults(s))),
    chrome.storage.session
      .get(StorageKey.NOW_PLAYING)
      .then((/** @type {any} */ s) => showNowPlaying(s[StorageKey.NOW_PLAYING])),
  ]);
  chrome.storage.onChanged.addListener((/** @type {any} */ changes, /** @type {string} */ area) => {
    if (area === "session" && changes[StorageKey.NOW_PLAYING]) showNowPlaying(changes[StorageKey.NOW_PLAYING].newValue);
  });
  return ready;
}
