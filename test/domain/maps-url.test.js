import { test } from "node:test";
import assert from "node:assert/strict";
import { dataBlocks, MapsUrl, PanoType } from "../../src/domain/maps-url.js";

const MAP = "https://www.google.com/maps/@52.5,13.4,15z";
const SV = "https://www.google.com/maps/@52.5,13.4,3a,75y,90h,90t";
const PANO = `${SV}/data=!3m6!1e1!3m4!1sPANO1!2e0!7i16384!8i8192`;
const DIR = "dir/Berlin+Hbf/Brandenburger+Tor";
const ROUTE = "!4m9!4m8!1m3!2m2!1d13.36!2d52.52!1m3!2m2!1d13.37!2d52.51";
const ROUTE_PANO = `https://www.google.com/maps/${DIR}/@52.5,13.4,3a,75y,90h,90t/data=!3m6!1e1!3m4!1sPANO1!2e0!7i16384!8i8192${ROUTE}`;

test("position from the URL, or none", () => {
  assert.deepEqual({ ...new MapsUrl(MAP).position }, { lat: 52.5, lng: 13.4 });
  assert.deepEqual(
    { ...new MapsUrl("https://www.google.com/maps/@-33.8,-151.2,10z").position },
    { lat: -33.8, lng: -151.2 },
  );
  assert.equal(new MapsUrl("https://www.google.com/maps").position, null);
});

test("recognises Street View by the 3a part or by a panorama id", () => {
  const sv = (href) => new MapsUrl(href).isStreetView;
  assert.equal(sv(MAP), false);
  assert.equal(sv(SV), true);
  assert.equal(sv("https://www.google.com/maps/@52.5,13.4,2.5a,75y,90h/data=x"), true);
  assert.equal(sv("https://www.google.com/maps/@52.5,13.4,17z/data=!3m4!1e1!3m2!1sPANO!2e0"), true); // indoor floors
  assert.equal(sv("https://www.google.com/maps/@52.5,13.4,15z/data=!5m1!1e1"), false); // the coverage layer
});

test("panorama: id, position and view", () => {
  const p = new MapsUrl(PANO).panorama;
  assert.equal(p.id, "PANO1");
  assert.deepEqual({ ...p.point }, { lat: 52.5, lng: 13.4 });
  assert.equal(p.heading, 90);
  assert.equal(p.fov, "75");
  assert.equal(p.tilt, "90");
  assert.equal(new MapsUrl(SV).panorama, null); // no id
  const defaults = new MapsUrl("https://www.google.com/maps/@1,2,3a,120h/data=!1sA%2FB!2e0").panorama;
  assert.deepEqual([defaults.id, defaults.fov, defaults.tilt, defaults.heading], ["A/B", "75", "90", 120]);
});

test("data parts split into their top-level blocks", () => {
  assert.deepEqual(dataBlocks("!3m6!1e1!3m4!1sX!2e0!7i1!8i1!4m2!4m1!1m0"), [
    "!3m6!1e1!3m4!1sX!2e0!7i1!8i1",
    "!4m2!4m1!1m0",
  ]);
  assert.deepEqual(dataBlocks("!1e1!5m1!1e2"), ["!1e1", "!5m1!1e2"]);
  assert.deepEqual(dataBlocks(""), []);
});

test("route: the directions path and the data blocks besides the view", () => {
  assert.deepEqual(new MapsUrl(ROUTE_PANO).route, { dir: DIR, data: ROUTE });
  assert.equal(new MapsUrl(PANO).route, null);
  assert.deepEqual(new MapsUrl(`https://www.google.com/maps/${DIR}/@52.5,13.4,12z`).route, { dir: DIR, data: "" });
});

test("panorama URLs: Google's, photospheres, with a route and the query string", () => {
  const base = { origin: "https://www.google.com", search: "", fov: "75", heading: 90, tilt: "90" };
  const google = { type: PanoType.GOOGLE, id: "PANO2", lat: 52.5, lng: 13.400295 };
  assert.equal(
    MapsUrl.forPanorama({ ...base, target: google }),
    "https://www.google.com/maps/@52.5,13.400295,3a,75y,90.00h,90t/data=!3m4!1e1!3m2!1sPANO2!2e0",
  );
  assert.equal(
    MapsUrl.forPanorama({ ...base, search: "?hl=de", target: { ...google, type: 10 } }),
    "https://www.google.com/maps/@52.5,13.400295,3a,75y,90.00h,90t/data=!3m5!1e1!3m3!1sPANO2!2e10!3e11?hl=de",
  );
  assert.equal(
    MapsUrl.forPanorama({ ...base, target: google, route: { dir: DIR, data: ROUTE } }),
    `https://www.google.com/maps/${DIR}/@52.5,13.400295,3a,75y,90.00h,90t/data=!3m4!1e1!3m2!1sPANO2!2e0${ROUTE}`,
  );
});

test("a URL built with a route parses back to the same route", () => {
  const href = MapsUrl.forPanorama({
    origin: "https://www.google.com",
    search: "",
    fov: "75",
    heading: 0,
    tilt: "90",
    target: { type: 2, id: "P", lat: 1, lng: 2 },
    route: { dir: DIR, data: ROUTE },
  });
  assert.deepEqual(new MapsUrl(href).route, { dir: DIR, data: ROUTE });
  assert.equal(new MapsUrl(href).panorama.id, "P");
});
