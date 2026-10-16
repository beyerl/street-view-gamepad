// Runs in the isolated content-script world and connects the page-world script
// (inject.js) to extension APIs: fullscreen, ambient sound and audio commentary
// via the background worker, and the user's settings from chrome.storage.

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
  } else if (e.data.type === "commentaryAt") {
    chrome.runtime.sendMessage({ type: "commentaryAt", lat: e.data.lat, lng: e.data.lng });
  } else if (e.data.type === "commentaryToggle" || e.data.type === "commentaryPause") {
    chrome.runtime.sendMessage({ type: e.data.type });
  } else if (e.data.type === "commentaryNext") {
    chrome.runtime.sendMessage({ type: "commentaryNext", step: e.data.step });
  } else if (e.data.type === "getSettings") {
    pushSettings();
  }
});

// Leaving the page (navigation, reload): stop this tab's sound. Sent from here
// rather than from inject.js so it doesn't depend on a postMessage hop.
window.addEventListener("pagehide", () => chrome.runtime.sendMessage({ type: "ambientStop" }));

// Commentary state (nearest article, playing/paused) from the background worker.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "commentary" || msg?.type === "commentaryNotice") {
    window.postMessage({ source: "sv-gamepad-bridge", ...msg }, "*");
  }
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "sync") pushSettings();
});

pushSettings();
