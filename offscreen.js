// Plays the ambient recording. Lives in an offscreen document because the
// Street View page itself may not autoplay audio (gamepad input is not a user
// gesture). Two <audio> elements allow crossfading between recordings.

const FADE_MS = 1500;
const players = [document.getElementById("a"), document.getElementById("b")];
let active = 0;
let volume = 0.5;
const fades = new Map(); // audio element -> interval id

function fade(audio, to, then) {
  clearInterval(fades.get(audio));
  const from = audio.volume;
  const start = performance.now();
  fades.set(audio, setInterval(() => {
    const t = Math.min((performance.now() - start) / FADE_MS, 1);
    audio.volume = from + (to - from) * t;
    if (t === 1) {
      clearInterval(fades.get(audio));
      fades.delete(audio);
      then?.();
    }
  }, 30));
}

function play(url) {
  const cur = players[active];
  if (cur.src === url) {
    // Same recording: resume where it was paused.
    if (cur.paused) cur.play().catch(() => {});
    fade(cur, volume);
    return;
  }
  fade(cur, 0, () => cur.pause());
  active = 1 - active;
  const next = players[active];
  next.src = url;
  next.volume = 0;
  next.play().catch((err) => console.warn("ambient play failed:", err));
  fade(next, volume);
}

function pause() {
  for (const p of players) fade(p, 0, () => p.pause());
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "status") {
    const p = players[active];
    sendResponse({ src: p.src, paused: p.paused, currentTime: p.currentTime, volume: p.volume });
    return;
  }
  if (typeof msg.volume === "number") volume = msg.volume;
  if (msg.type === "play") play(msg.url);
  else if (msg.type === "pause") pause();
  else if (msg.type === "volume") {
    const cur = players[active];
    if (!cur.paused) fade(cur, volume);
  }
});
