// Runs in the isolated content-script world and connects the page-world script
// (inject.js) to extension APIs: fullscreen and ambient sound via the
// background worker, and the user's settings from chrome.storage.

async function pushSettings() {
  const settings = await chrome.storage.sync.get(SVG_DEFAULTS);
  window.postMessage({ source: "sv-gamepad-bridge", type: "settings", settings }, "*");
}

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "sv-gamepad") return;
  if (e.data.type === "toggleFullscreen") {
    chrome.runtime.sendMessage({ type: "toggleFullscreen" });
  } else if (e.data.type === "ambient") {
    chrome.runtime.sendMessage({ type: "ambient", lat: e.data.lat, lng: e.data.lng });
  } else if (e.data.type === "ambientStop") {
    chrome.runtime.sendMessage({ type: "ambientStop" });
  } else if (e.data.type === "getSettings") {
    pushSettings();
  }
});

// Leaving the page (navigation, reload): stop this tab's sound. Sent from here
// rather than from inject.js so it doesn't depend on a postMessage hop.
window.addEventListener("pagehide", () => chrome.runtime.sendMessage({ type: "ambientStop" }));

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "sync") pushSettings();
});

pushSettings();
