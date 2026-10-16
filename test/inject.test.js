const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers");

function loadInject(href = "") {
  const noop = () => {};
  const window = { addEventListener: noop, postMessage: noop };
  return load(
    "inject.js",
    { window, location: { href }, document: {}, setInterval: noop, setTimeout: noop, navigator: {} },
    ["currentPano", "offset", "distBearing"],
    { wrap: true },
  );
}

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("distBearing: due north, east, south, west", () => {
  const { distBearing } = loadInject();
  near(distBearing(0, 0, 1, 0).bearing, 0);
  near(distBearing(0, 0, 0, 1).bearing, 90);
  near(distBearing(0, 0, -1, 0).bearing, 180);
  near(distBearing(0, 0, 0, -1).bearing, 270);
  near(distBearing(0, 0, 1, 0).m, 111195, 10);
});

test("offset and distBearing are inverse", () => {
  const { offset, distBearing } = loadInject();
  const [lat, lng] = offset(48, 11, 135, 50);
  const { m, bearing } = distBearing(48, 11, lat, lng);
  near(m, 50, 0.01);
  near(bearing, 135, 0.01);
});

test("currentPano parses a Street View URL", () => {
  const href = "https://www.google.com/maps/@48.1371,11.5754,3a,75y,90h,85t/data=!3m6!1e1!3m4!1sABC_def-1!2e0!7i16384!8i8192";
  const p = loadInject(href).currentPano();
  assert.equal(p.id, "ABC_def-1");
  assert.equal(p.lat, 48.1371);
  assert.equal(p.lng, 11.5754);
  assert.equal(p.heading, 90);
  assert.equal(p.fov, "75");
  assert.equal(p.tilt, "85");
});

test("currentPano returns null outside Street View", () => {
  assert.equal(loadInject("https://www.google.com/maps/@48.1,11.5,15z").currentPano(), null);
});
