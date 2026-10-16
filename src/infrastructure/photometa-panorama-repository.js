// Panoramas near a point, via the unofficial endpoint the Maps web app uses
// itself. Same-origin on the Maps page, so no API key is needed. May break
// when Google changes it.

import { PanoramaRepository } from "../ports/index.js";

const ENDPOINT = "/maps/photometa/si/v1";
const XSSI_PREFIX = /^\)\]\}'/;

/** @implements {PanoramaRepository} */
export class PhotometaPanoramaRepository extends PanoramaRepository {
  /** @param {typeof globalThis.fetch} fetch */
  constructor(fetch) {
    super();
    this.fetch = fetch;
  }

  async nearest(/** @type {import("../domain/geo.js").GeoPoint} */ point, /** @type {number} */ radiusM) {
    const pb =
      `!1m5!1sapiv3!5sUS!11m2!1m1!1b0!2m4!1m2!3d${point.lat}!4d${point.lng}!2d${Math.round(radiusM)}` +
      "!3m18!2m2!1sen!2sUS!9m1!1e2!11m12!1m3!1e2!2b1!3e2!1m3!1e3!2b1!3e2!1m3!1e10!2b1!3e2" +
      "!4m6!1e1!1e2!1e3!1e4!1e8!1e6";
    const res = await this.fetch(`${ENDPOINT}?pb=${encodeURIComponent(pb)}`);
    if (!res.ok) throw new Error(`pano search: HTTP ${res.status}`);
    const r = JSON.parse((await res.text()).replace(XSSI_PREFIX, ""))[1];
    const pos = r?.[5]?.[0]?.[1]?.[0];
    if (!r?.[1]?.[1] || !pos) return null;
    return { type: r[1][0], id: r[1][1], lat: pos[2], lng: pos[3] };
  }
}
