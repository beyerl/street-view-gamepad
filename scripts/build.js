// Bundles each entry point into dist/ as a classic script: MV3 content scripts
// can't be ES modules, and one format for all contexts keeps it simple.
//   node scripts/build.js           build once
//   node scripts/build.js --watch   rebuild on change
import * as esbuild from "esbuild";

export const ENTRIES = {
  page: "src/entry/page-main.js", // content script, MAIN world
  bridge: "src/entry/bridge-main.js", // content script, isolated world
  "visit-link": "src/entry/visit-link-main.js", // content script on the Virtual Visit game, isolated world
  background: "src/entry/background-main.js",
  offscreen: "src/entry/offscreen-main.js",
  popup: "src/entry/popup-main.js",
  mapping: "src/entry/mapping-main.js",
};

const options = {
  entryPoints: ENTRIES,
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  legalComments: "none",
  logLevel: "info",
};

if (process.argv.includes("--watch")) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
