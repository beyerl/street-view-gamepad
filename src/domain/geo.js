// Positions on the earth, at the scale of a street: an equirectangular
// approximation is plenty.

export const EARTH_RADIUS_M = 6371000;
const RAD = Math.PI / 180;
const KEY_DECIMALS = 4; // ~10 m

export class GeoPoint {
  /** @param {number} lat @param {number} lng */
  constructor(lat, lng) {
    this.lat = lat;
    this.lng = lng;
    Object.freeze(this);
  }

  /** Distance in metres and the bearing (° clockwise from north) to another point.
   * @param {{ lat: number, lng: number }} to */
  to(to) {
    const x = (to.lng - this.lng) * RAD * Math.cos(((this.lat + to.lat) / 2) * RAD);
    const y = (to.lat - this.lat) * RAD;
    return { m: EARTH_RADIUS_M * Math.hypot(x, y), bearing: Heading.normalize(Math.atan2(x, y) / RAD) };
  }

  /** @param {{ lat: number, lng: number }} to */
  distanceTo(to) {
    return this.to(to).m;
  }

  /** The point `m` metres away in direction `bearing`. @param {number} bearing @param {number} m */
  offset(bearing, m) {
    return new GeoPoint(
      this.lat + (m * Math.cos(bearing * RAD)) / EARTH_RADIUS_M / RAD,
      this.lng + (m * Math.sin(bearing * RAD)) / (EARTH_RADIUS_M * Math.cos(this.lat * RAD)) / RAD,
    );
  }

  /** Rounded to ~10 m, as a key to notice movement. */
  key() {
    return `${this.lat.toFixed(KEY_DECIMALS)},${this.lng.toFixed(KEY_DECIMALS)}`;
  }
}

export const Heading = Object.freeze({
  /** Into 0 <= h < 360. @param {number} h */
  normalize: (h) => ((h % 360) + 360) % 360,
  /** Smallest angle between two headings, 0-180. @param {number} a @param {number} b */
  diff: (a, b) => Math.abs(((a - b + 360 + 180) % 360) - 180),
});

/** @param {number} m */
export const formatDistance = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
