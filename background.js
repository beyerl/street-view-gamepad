// Toggles the browser window into/out of fullscreen. Done here rather than via
// element.requestFullscreen() because gamepad input does not count as a user
// gesture, so the page itself is not allowed to enter fullscreen.

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "toggleFullscreen" || !sender.tab) return;
  toggleFullscreen(sender.tab.windowId);
});

async function toggleFullscreen(windowId) {
  const win = await chrome.windows.get(windowId);
  const key = `prevState:${windowId}`;

  if (win.state === "fullscreen") {
    const stored = await chrome.storage.session.get(key);
    const prev = stored[key] || "normal";
    await chrome.windows.update(windowId, { state: prev });
    await chrome.storage.session.remove(key);
  } else {
    await chrome.storage.session.set({ [key]: win.state });
    await chrome.windows.update(windowId, { state: "fullscreen" });
  }
}
