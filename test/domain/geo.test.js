import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDistance, GeoPoint, Heading } from "../../src/domain/geo.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("distance: zero, one degree of latitude, symmetry, longitude shrinking towards the poles", () => {
  const p = new GeoPoint(52.5, 13.4);
  assert.equal(p.distanceTo(p), 0);
  near(new GeoPoint(0, 0).distanceTo({ lat: 1, lng: 0 }), 111194.9, 0.1);
  near(p.distanceTo({ lat: 48.85, lng: 2.35 }), new GeoPoint(48.85, 2.35).distanceTo(p));
  assert.ok(new GeoPoint(60, 0).distanceTo({ lat: 60, lng: 1 }) < new GeoPoint(0, 0).distanceTo({ lat: 0, lng: 1 }));
});

test("bearing points the right way", () => {
  const p = new GeoPoint(52.5, 13.4);
  near(p.to({ lat: 52.6, lng: 13.4 }).bearing, 0);
  near(p.to({ lat: 52.5, lng: 13.5 }).bearing, 90);
  near(p.to({ lat: 52.4, lng: 13.4 }).bearing, 180);
  near(p.to({ lat: 52.5, lng: 13.3 }).bearing, 270);
});

test("offset goes the given distance in the given direction", () => {
  const p = new GeoPoint(52.5, 13.4);
  for (const bearing of [0, 45, 90, 200, 315]) {
    const q = p.offset(bearing, 100);
    const { m, bearing: b } = p.to(q);
    near(m, 100, 1e-3);
    near(Heading.diff(b, bearing), 0, 1e-3);
  }
});

test("points are frozen and keyed to ~10 m", () => {
  const p = new GeoPoint(52.500001, 13.400001);
  assert.ok(Object.isFrozen(p));
  assert.equal(p.key(), "52.5000,13.4000");
});

test("headings", () => {
  assert.equal(Heading.normalize(-90), 270);
  assert.equal(Heading.normalize(450), 90);
  assert.equal(Heading.diff(350, 10), 20);
  assert.equal(Heading.diff(10, 350), 20);
  assert.equal(Heading.diff(0, 180), 180);
});

test("distances are shown in m, or in km from 1 km", () => {
  assert.equal(formatDistance(19.6), "20 m");
  assert.equal(formatDistance(999), "999 m");
  assert.equal(formatDistance(2049), "2.0 km");
});
