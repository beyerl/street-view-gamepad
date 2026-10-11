// Plays the ambient recording. Lives in an offscreen document because the
// Street View page itself may not autoplay audio (gamepad input is not a user
// gesture). Two <audio> elements allow crossfading between recordings; a third
// plays the commentary, during which the ambient sound is lowered.

const FADE_MS = 1500;
const DUCK = 0.25; // ambient volume factor while commentary plays
const players = [document.getElementById("a"), document.getElementById("b")];
const commentary = document.getElementById("c");
let active = 0;
let volume = 0.5; // ambient
let ducked = false;
const ambientVolume = () => volume * (ducked ? DUCK : 1);
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
    fade(cur, ambientVolume());
    return;
  }
  fade(cur, 0, () => cur.pause());
  active = 1 - active;
  const next = players[active];
  next.src = url;
  next.volume = 0;
  next.play().catch((err) => console.warn("ambient play failed:", err));
  fade(next, ambientVolume());
}

function pause() {
  for (const p of players) fade(p, 0, () => p.pause());
}

function duck(on) {
  ducked = on;
  const cur = players[active];
  if (!cur.paused) fade(cur, ambientVolume());
}

// --- Commentary ------------------------------------------------------------
// Either a Spoken Wikipedia recording (one URL) or an article read by Piper
// (piper.js), synthesized sentence by sentence a little ahead of playback.
const READ_AHEAD = 2; // sentences synthesized ahead of the one playing
let speech = null; // { queue: [blob url], done, playing, waiting }

const notify = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});
const finish = (error) => {
  stopCommentary();
  notify({ type: "commentaryEnded", error });
};
Piper.onProgress = (message) => notify({ type: "commentaryNotice", message });

function stopCommentary() {
  if (speech) speech.queue.forEach(URL.revokeObjectURL);
  speech = null;
  commentary.pause();
  if (commentary.src.startsWith("blob:")) URL.revokeObjectURL(commentary.src);
  commentary.removeAttribute("src");
  commentary.load();
  duck(false);
}

function startPlayback() {
  commentary.play().catch((err) => {
    console.warn("commentary play failed:", err);
    finish(`Commentary could not be played: ${err.message}`);
  });
  duck(true);
}

function playRecording(url) {
  stopCommentary();
  commentary.src = url;
  startPlayback();
}

async function speak(text, lang) {
  stopCommentary();
  const s = speech = { queue: [], done: false, playing: true, waiting: true };
  duck(true);
  try {
    for await (const blob of Piper.speak(text, lang)) {
      if (speech !== s) return;
      s.queue.push(URL.createObjectURL(blob));
      if (s.waiting && s.playing) nextSentence(s);
      while (s.queue.length >= READ_AHEAD && speech === s) await new Promise((r) => setTimeout(r, 200));
    }
    s.done = true;
    if (s.waiting && speech === s) finish();
  } catch (err) {
    console.warn("text-to-speech failed:", err);
    if (speech === s) finish(`Text-to-speech failed: ${err.message}`);
  }
}

function nextSentence(s) {
  const url = s.queue.shift();
  if (commentary.src.startsWith("blob:")) URL.revokeObjectURL(commentary.src);
  if (!url) {
    s.waiting = true;
    if (s.done) finish();
    return;
  }
  if (s.waiting) notify({ type: "commentaryNotice", message: "" }); // clear "Downloading…"
  s.waiting = false;
  commentary.src = url;
  startPlayback();
}

commentary.addEventListener("ended", () => {
  if (speech) nextSentence(speech);
  else finish();
});

function pauseCommentary() {
  if (speech) speech.playing = false;
  commentary.pause();
  duck(false);
}

// False if there is nothing to resume (e.g. this document was recreated).
function resumeCommentary() {
  if (speech) {
    speech.playing = true;
    duck(true);
    if (!speech.waiting) startPlayback();
    else if (speech.queue.length) nextSentence(speech);
    return true;
  }
  if (!commentary.src) return false;
  startPlayback();
  return true;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "status") {
    const p = players[active];
    sendResponse({ src: p.src, paused: p.paused, currentTime: p.currentTime, volume: p.volume });
    return;
  }
  if (typeof msg.volume === "number") volume = msg.volume;
  if (typeof msg.commentaryVolume === "number") commentary.volume = msg.commentaryVolume;
  if (msg.type === "play") play(msg.url);
  else if (msg.type === "pause") pause();
  else if (msg.type === "volume") {
    const cur = players[active];
    if (!cur.paused) fade(cur, ambientVolume());
  } else if (msg.type === "commentaryPlay") playRecording(msg.url);
  else if (msg.type === "commentarySpeak") speak(msg.text, msg.lang);
  else if (msg.type === "commentaryPreload") Piper.preload(msg.lang).catch((err) => console.warn("preload:", err));
  else if (msg.type === "commentaryPause") pauseCommentary();
  else if (msg.type === "commentaryResume") sendResponse({ ok: resumeCommentary() });
  else if (msg.type === "commentaryStop") stopCommentary();
});
