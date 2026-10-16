// Packs the built extension into release/street-view-gamepad.zip, which is
// committed so it can be installed without Node: unzip, then "Load unpacked".
//   node scripts/package.js           build the zip (run `npm run build` first)
//   node scripts/package.js --check   fail if the committed zip doesn't match the build
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ZIP = "release/street-view-gamepad.zip";
// Everything Chrome needs to load the extension.
const FILES = ["manifest.json", "popup.html", "mapping.html", "offscreen.html", "vendor", "dist"];

/** Relative paths of all files under the given roots, sorted. */
function list(base, roots) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(base, rel);
    if (fs.statSync(abs).isDirectory()) for (const e of fs.readdirSync(abs)) walk(path.join(rel, e));
    else out.push(rel);
  };
  roots.forEach(walk);
  return out.sort();
}

function pack() {
  for (const f of FILES) if (!fs.existsSync(f)) throw new Error(`${f} is missing; run npm run build first`);
  fs.mkdirSync(path.dirname(ZIP), { recursive: true });
  fs.rmSync(ZIP, { force: true });
  // -X: no extra file attributes, so the zip only changes when the files do.
  execFileSync("zip", ["-q", "-X", "-r", ZIP, ...list(".", FILES)]);
  console.log(`${ZIP}: ${(fs.statSync(ZIP).size / 1e6).toFixed(1)} MB`);
}

function check() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svgp-zip-"));
  try {
    execFileSync("unzip", ["-q", ZIP, "-d", tmp]);
    const want = list(".", FILES);
    const got = list(tmp, fs.readdirSync(tmp));
    const differ = [...new Set([...want, ...got])].filter(
      (f) => !want.includes(f) || !got.includes(f) || !fs.readFileSync(f).equals(fs.readFileSync(path.join(tmp, f))),
    );
    if (differ.length) {
      console.error(`${ZIP} is out of date (${differ.join(", ")}). Run npm run package and commit it.`);
      process.exit(1);
    }
    console.log(`${ZIP} matches the build`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv.includes("--check")) check();
else pack();
