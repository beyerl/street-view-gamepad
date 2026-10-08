const keys = Object.keys(SVG_DEFAULTS);

function show(settings) {
  for (const k of keys) {
    document.getElementById(k).value = settings[k];
    const out = document.getElementById(`${k}-out`);
    if (out) out.textContent = settings[k];
  }
}

for (const k of keys) {
  document.getElementById(k).addEventListener("input", (e) => {
    const value = typeof SVG_DEFAULTS[k] === "number" ? Number(e.target.value) : e.target.value;
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
