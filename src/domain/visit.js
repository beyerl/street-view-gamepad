// A Virtual Visit stop: the Virtual Visit game hands one over before it sends
// the tab to Google Maps. We enter Street View at the start of its walking
// route, remember every move (the game's autosave), and when the player
// presses both shoulder buttons, mark it finished and go back to the game.
//
// Protocol on the game's page (window.postMessage):
//   game -> extension  { source: "virtual-visit", type: "vv-hello" | "vv-start" | "vv-clear", ticket? }
//   extension -> game  { source: "sv-gamepad-visit", type: "vv-state", ticket, version } | { type: "vv-started" }

import { GeoPoint } from "./geo.js";

export const VisitState = Object.freeze({
  ENTERING: "entering", // Maps shows the route; Street View still has to be entered
  VISITING: "visiting",
});

/**
 * @typedef {{ lat: number, lng: number, heading?: number, url?: string }} VisitPosition
 * @typedef {{ slot: string, returnUrl: string, origin: string, destination: string, resumeUrl?: string,
 *             state: string, finished: boolean, position: VisitPosition | null, startedAt: number }} Visit
 */

/** "lat,lng" → GeoPoint, or null. @param {unknown} s */
export function parsePoint(s) {
  const m = typeof s === "string" && s.match(/^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/);
  return m ? new GeoPoint(+m[1], +m[2]) : null;
}

/**
 * A ticket from the game, checked: it may only send the player back to the
 * page it came from.
 * @param {any} ticket @param {string} pageOrigin @param {number} now @returns {Visit | null}
 */
export function acceptTicket(ticket, pageOrigin, now) {
  if (!ticket || typeof ticket.slot !== "string" || !ticket.slot) return null;
  let back;
  try {
    back = new URL(ticket.returnUrl);
  } catch {
    return null;
  }
  if (back.origin !== pageOrigin) return null;
  if (!parsePoint(ticket.origin) || !parsePoint(ticket.destination)) return null;
  const resume = typeof ticket.resumeUrl === "string" && /^https:\/\/www\.google\.[a-z.]+\/maps/.test(ticket.resumeUrl);
  const p = ticket.position;
  return {
    slot: ticket.slot,
    returnUrl: back.href,
    origin: ticket.origin,
    destination: ticket.destination,
    ...(resume ? { resumeUrl: ticket.resumeUrl } : {}),
    state: VisitState.ENTERING,
    finished: false,
    position: p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { ...p } : null,
    startedAt: now,
  };
}
