const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers");

const noop = () => {};
const event = { addListener: noop };
const chrome = {
  runtime: { onMessage: event, id: "id", getManifest: () => ({ version: "1.0" }) },
  i18n: { getUILanguage: () => "en-US" },
  declarativeNetRequest: { updateDynamicRules: () => Promise.resolve() },
  storage: { onChanged: event, local: {}, sync: {}, session: {} },
  tabs: { onRemoved: event },
  windows: {},
  offscreen: {},
};
const { distanceKm, nearest } = load(
  "background.js",
  { chrome, importScripts: noop },
  ["distanceKm", "nearest"],
);

test("distanceKm is zero for identical points", () => {
  assert.equal(distanceKm(48, 11, 48, 11), 0);
});

test("distanceKm: one degree of latitude is about 111 km", () => {
  assert.ok(Math.abs(distanceKm(0, 0, 1, 0) - 111.19) < 0.1);
});

test("distanceKm shrinks east-west with latitude", () => {
  assert.ok(distanceKm(60, 0, 60, 1) < distanceKm(0, 0, 0, 1) * 0.55);
});

test("distanceKm is symmetric", () => {
  assert.ok(Math.abs(distanceKm(10, 20, 11, 22) - distanceKm(11, 22, 10, 20)) < 1e-9);
});

test("nearest picks the closest location", () => {
  const locs = [[1, 10, 10], [2, 50.1, 8.1], [3, 51, 9]];
  const { loc, km } = nearest(locs, 50, 8);
  assert.equal(loc[0], 2);
  assert.ok(km > 0 && km < 20);
});

test("nearest of nothing", () => {
  assert.deepEqual({ ...nearest([], 0, 0) }, { loc: null, km: Infinity });
});
