import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptTicket, parsePoint, VisitState } from "../../src/domain/visit.js";

const ticket = {
  slot: "g1",
  returnUrl: "https://beyerl.github.io/virtual-visit/#visit=g1",
  origin: "35.6812,139.7649",
  destination: "35.6797,139.7546",
};

test("visit: parses lat,lng points", () => {
  assert.deepEqual({ ...parsePoint("35.6812,139.7649") }, { lat: 35.6812, lng: 139.7649 });
  assert.deepEqual({ ...parsePoint(" -1.5, 2 ") }, { lat: -1.5, lng: 2 });
  assert.equal(parsePoint("x,1"), null);
  assert.equal(parsePoint(5), null);
});

test("visit: a ticket is accepted entering, unfinished, without a position", () => {
  const v = acceptTicket(ticket, "https://beyerl.github.io", 7);
  assert.equal(v.state, VisitState.ENTERING);
  assert.equal(v.finished, false);
  assert.equal(v.position, null);
  assert.equal(v.startedAt, 7);
  assert.equal(v.returnUrl, ticket.returnUrl);
});

test("visit: only returns to the page it came from; needs a slot and points; keeps only Maps resume URLs", () => {
  assert.equal(acceptTicket(ticket, "https://evil.example", 0), null);
  assert.equal(acceptTicket({ ...ticket, returnUrl: "javascript:alert(1)" }, "https://beyerl.github.io", 0), null);
  assert.equal(acceptTicket({ ...ticket, slot: "" }, "https://beyerl.github.io", 0), null);
  assert.equal(acceptTicket({ ...ticket, origin: "nope" }, "https://beyerl.github.io", 0), null);
  assert.equal(acceptTicket(null, "https://beyerl.github.io", 0), null);
  const resume = "https://www.google.com/maps/@35.68,139.76,3a,75y,90h,90t/data=!3m4!1e1!3m2!1sP!2e0";
  assert.equal(acceptTicket({ ...ticket, resumeUrl: resume }, "https://beyerl.github.io", 0).resumeUrl, resume);
  assert.equal(
    acceptTicket({ ...ticket, resumeUrl: "https://evil.example/maps" }, "https://beyerl.github.io", 0).resumeUrl,
    undefined,
  );
  const withPos = acceptTicket({ ...ticket, position: { lat: 1, lng: 2, heading: 3 } }, "https://beyerl.github.io", 0);
  assert.deepEqual(withPos.position, { lat: 1, lng: 2, heading: 3 });
});
