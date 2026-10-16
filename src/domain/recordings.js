// Field recordings of radio aporee ::: maps.

/** @typedef {[locid: number, lat: number, lng: number]} RecordingLocation */
/** A recording as aporee's playlist lists it.
 * @typedef {{ mp3: string, ctitle: string, ltitle: string, artist: string, licence: string, recdate: string }} Recording */

/** The location closest to a point. @param {RecordingLocation[]} locations @param {import("./geo.js").GeoPoint} point */
export function nearestLocation(locations, point) {
  let loc = null;
  let m = Infinity;
  for (const l of locations) {
    const d = point.distanceTo({ lat: l[1], lng: l[2] });
    if (d < m) [loc, m] = [l, d];
  }
  return { loc, km: m / 1000 };
}
