import { test } from "node:test";
import assert from "node:assert/strict";
import { bindingLabel, InputDetector, isBindingActive } from "../../src/domain/binding.js";
import { pad } from "../helpers/fakes.js";

test("button bindings", () => {
  assert.equal(isBindingActive(3, pad([3])), true);
  assert.equal(isBindingActive(3, pad([2])), false);
  assert.equal(isBindingActive(40, pad([3])), false);
});

test("axis direction bindings are active past half deflection", () => {
  assert.equal(isBindingActive("a1-", pad([], [0, -0.4])), false);
  assert.equal(isBindingActive("a1-", pad([], [0, -0.9])), true);
  assert.equal(isBindingActive("a1+", pad([], [0, -0.9])), false);
  assert.equal(isBindingActive("a1+", pad([], [0, 0.6])), true);
});

test("hat bindings are active only at their position", () => {
  for (const v of [1.2857, -0.7143, 0.1429])
    assert.equal(isBindingActive("a9=-1.00", pad([], Object.assign(Array(10).fill(0), { 9: v }))), false);
  assert.equal(isBindingActive("a9=-1.00", pad([], Object.assign(Array(10).fill(0), { 9: -1 }))), true);
  assert.equal(isBindingActive("a2=0.14", pad([], [0, 0, 0.1429])), true);
});

test("malformed bindings, missing axes and null are never active", () => {
  for (const b of ["x1", "a5+", "a1", "", null, undefined, {}]) {
    assert.equal(isBindingActive(b, pad([0, 1], [1, 1])), false, String(b));
  }
  assert.equal(isBindingActive("a0+", { buttons: [] }), false);
});

test("labels", () => {
  assert.equal(bindingLabel(7), "Button 7");
  assert.equal(bindingLabel(null), "—");
  assert.equal(bindingLabel("a1-"), "Axis 1 -");
  assert.equal(bindingLabel("a9=-1.00"), "Axis 9 = -1.00");
  assert.equal(bindingLabel("zz"), "?");
});

test("detector: buttons, then sticks moved from rest", () => {
  const d = new InputDetector();
  assert.deepEqual(d.pressed(pad([], [0, 0.02])), []); // rest taken
  assert.deepEqual(d.pressed(pad([4], [0, -0.9])), [4, "a1-"]);
  assert.deepEqual(d.pressed(pad([], [0.8, 0])), ["a0+"]);
});

test("detector: an axis resting at -1 (a trigger) counts from there", () => {
  const d = new InputDetector();
  assert.deepEqual(d.pressed(pad([], [0, 0, -1])), []);
  assert.deepEqual(d.pressed(pad([], [0, 0, 1])), ["a2+"]);
});

test("detector: a hat switch is reported by its position", () => {
  const d = new InputDetector();
  assert.deepEqual(d.pressed(pad([], [0, 0, 1.2857])), []);
  assert.deepEqual(d.pressed(pad([], [0, 0, 0.1429])), ["a2=0.14"]);
  assert.deepEqual(d.pressed(pad([], [0, 0, 1])), ["a2=1.00"]); // up-left, close to rest
});

test("detector: held uses the lower release threshold; reset takes rest anew; pads are separate", () => {
  const d = new InputDetector();
  d.pressed(pad([], [0]));
  assert.equal(d.held(pad([], [0.4])), true);
  assert.equal(d.held(pad([], [0.2])), false);
  d.reset();
  assert.deepEqual(d.pressed(pad([], [0.9])), []); // the new rest
  assert.deepEqual(d.pressed(pad([], [0.9], 1)), []);
  assert.deepEqual(d.pressed(pad([], [-0.5], 1)), ["a0-"]);
});
