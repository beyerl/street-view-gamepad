const keys = Object.keys(SVG_DEFAULTS).filter((k) => k !== "buttonMap");

document.getElementById("mapping").addEventListener("click", () => {
  chrome.windows.create({ url: "mapping.html", type: "popup", width: 520, height: 900 });
  window.close();
});

function show(settings) {
  for (const k of keys) {
    const el = document.getElementById(k);
    if (el.type === "checkbox") el.checked = settings[k];
    else el.value = settings[k];
    const out = document.getElementById(`${k}-out`);
    if (out) out.textContent = settings[k];
  }
}

for (const k of keys) {
  document.getElementById(k).addEventListener("input", (e) => {
    const t = e.target;
    const value = t.type === "checkbox" ? t.checked
      : typeof SVG_DEFAULTS[k] === "number" ? Number(t.value) : t.value;
    const out = document.getElementById(`${k}-out`);
    if (out) out.textContent = value;
    chrome.storage.sync.set({ [k]: value });
  });
}

document.getElementById("reset").addEventListener("click", async () => {
  await chrome.storage.sync.set(SVG_DEFAULTS);
  show(SVG_DEFAULTS);
});

chrome.storage.sync.get(SVG_DEFAULTS).then(show);

// Attribution for the current recording (radio aporee ::: maps, mostly CC licensed).
function showNowPlaying(np) {
  const box = document.getElementById("nowPlaying");
  box.hidden = !np;
  if (!np) return;
  const title = document.getElementById("np-title");
  title.textContent = np.title || np.place;
  title.href = np.link;
  document.getElementById("np-meta").textContent =
    `${np.place} · ${np.km} km away · by ${np.artist}, ${np.recdate} · ${np.licence} · radio aporee ::: maps`;
}

chrome.storage.session.get("nowPlaying").then(({ nowPlaying }) => showNowPlaying(nowPlaying));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.nowPlaying) showNowPlaying(changes.nowPlaying.newValue);
});
