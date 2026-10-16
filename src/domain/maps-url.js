// Google Maps URLs. Everything we know about their format is in this file.
//
//   /maps/@52.5,13.4,15z                                          the map
//   /maps/@52.5,13.4,3a,75y,90h,90t/data=!3m6!1e1!3m4!1s<pano>!2e0!7i…   Street View
//   /maps/dir/A/B/@52.5,13.4,3a,…/data=!3m6…!4m9!4m8…             Street View with directions
//
// The data part is a serialized protobuf: "!<field><type><value>", where
// type "m" opens a block holding the next <value> tokens.

import { GeoPoint } from "./geo.js";

/** Panorama kinds as the photometa endpoint reports them. */
export const PanoType = Object.freeze({ GOOGLE: 2 });

/** Top-level blocks of a data part. @param {string} data @returns {string[]} */
export function dataBlocks(data) {
  const tokens = data.split("!").filter(Boolean);
  const blocks = [];
  for (let i = 0; i < tokens.length;) {
    const n = +(tokens[i].match(/^\d+m(\d+)$/)?.[1] || 0);
    blocks.push(
      tokens
        .slice(i, i + 1 + n)
        .map((t) => `!${t}`)
        .join(""),
    );
    i += 1 + n;
  }
  return blocks;
}

/**
 * @typedef {{ dir: string, data: string }} Route  the /maps/dir/… path and the data blocks besides the view's
 * @typedef {{ id: string, point: GeoPoint, fov: string, heading: number, tilt: string }} PanoView
 * @typedef {{ type: number, id: string, lat: number, lng: number }} PanoTarget
 */

export class MapsUrl {
  /** @param {string} href */
  constructor(href) {
    this.href = href;
  }

  /** The position in the URL (Street View location, or map centre). @returns {GeoPoint | null} */
  get position() {
    const m = this.href.match(/@(-?[\d.]+),(-?[\d.]+),/);
    return m ? new GeoPoint(+m[1], +m[2]) : null;
  }

  /** Street View rather than the map: the "3a" view part, or a panorama id in
   * the data part (indoor panoramas with several floors don't always carry
   * the former). "!1e1" alone is the map's Street View coverage layer. */
  get isStreetView() {
    return /@[^/]*,\d+(?:\.\d+)?a,/.test(this.href) || /\/data=[^?#]*!1s[^!/?]+!2e\d/.test(this.href);
  }

  /** @returns {PanoView | null} */
  get panorama() {
    const at = this.href.match(/@(-?[\d.]+),(-?[\d.]+),[^/]*?(?:,([\d.]+)y)?,([\d.]+)h(?:,([\d.]+)t)?/);
    const id = this.href.match(/!1s([^!/?]+)!2e/);
    if (!at || !id) return null;
    return {
      id: decodeURIComponent(id[1]),
      point: new GeoPoint(+at[1], +at[2]),
      fov: at[3] || "75",
      heading: +at[4],
      tilt: at[5] || "90",
    };
  }

  /** The directions shown with this view, if any. @returns {Route | null} */
  get route() {
    const dir = this.href.match(/\/maps\/(dir\/.*?)\/@/);
    if (!dir) return null;
    const data = this.href.match(/\/data=([^/?#]*)/);
    const blocks = data ? dataBlocks(data[1]).filter((b) => !/^!3[a-z]/.test(b)) : [];
    return { dir: dir[1], data: blocks.join("") };
  }

  /**
   * URL of a panorama, keeping a route.
   * @param {{ origin: string, search: string, target: PanoTarget, fov: string, heading: number, tilt: string, route?: Route | null }} o
   */
  static forPanorama({ origin, search, target, fov, heading, tilt, route }) {
    const data =
      target.type === PanoType.GOOGLE ? `!3m4!1e1!3m2!1s${target.id}!2e0` : `!3m5!1e1!3m3!1s${target.id}!2e10!3e11`;
    return (
      `${origin}/maps/${route ? `${route.dir}/` : ""}@${target.lat},${target.lng},3a,${fov}y,` +
      `${heading.toFixed(2)}h,${tilt}t/data=${data}${route?.data || ""}${search}`
    );
  }
}
