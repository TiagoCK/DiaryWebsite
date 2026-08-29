import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampPercent,
  sanitiseBox,
  toOriginalSpace,
  toRotatedSpace,
} from "../src/lib/redaction.js";

const ROTATIONS = [0, 90, 180, 270];

/** An off-centre, non-square box, so a wrong axis or a flipped sign shows up. */
const BOX = { x: 10, y: 20, width: 30, height: 15 };

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const boxesEqual = (a, b, msg) => {
  for (const k of ["x", "y", "width", "height"]) close(a[k], b[k], `${msg}.${k}`);
};

describe("redaction geometry", () => {
  for (const rotation of ROTATIONS) {
    it(`round-trips through ${rotation}°`, () => {
      // The property that matters: a bar drawn on the rotated view and stored
      // in original space must come back to the same place on screen. If this
      // drifts, a censor bar slides off what it was covering -- a leak, not a
      // cosmetic bug.
      const rotated = toRotatedSpace(BOX, rotation);
      boxesEqual(toOriginalSpace(rotated, rotation), BOX, `${rotation}°`);
    });
  }

  for (const rotation of ROTATIONS) {
    it(`preserves area at ${rotation}°`, () => {
      const r = toRotatedSpace(BOX, rotation);
      close(r.width * r.height, BOX.width * BOX.height, "area");
    });
  }

  it("swaps the axes on a quarter turn and keeps them on a half turn", () => {
    for (const rotation of [90, 270]) {
      const r = toRotatedSpace(BOX, rotation);
      close(r.width, BOX.height, `${rotation}° width`);
      close(r.height, BOX.width, `${rotation}° height`);
    }
    const half = toRotatedSpace(BOX, 180);
    close(half.width, BOX.width, "180° width");
    close(half.height, BOX.height, "180° height");
  });

  it("leaves a box untouched at 0°", () => {
    boxesEqual(toRotatedSpace(BOX, 0), BOX, "identity");
  });

  it("is its own inverse at 180°", () => {
    boxesEqual(toRotatedSpace(toRotatedSpace(BOX, 180), 180), BOX, "double half turn");
  });

  it("keeps a box inside the image at every rotation", () => {
    for (const rotation of ROTATIONS) {
      const r = toRotatedSpace(BOX, rotation);
      assert.ok(r.x >= 0 && r.y >= 0, `${rotation}° origin inside`);
      assert.ok(r.x + r.width <= 100 + 1e-9, `${rotation}° right edge inside`);
      assert.ok(r.y + r.height <= 100 + 1e-9, `${rotation}° bottom edge inside`);
    }
  });

  it("treats equivalent rotations the same", () => {
    boxesEqual(toRotatedSpace(BOX, 450), toRotatedSpace(BOX, 90), "450 = 90");
    boxesEqual(toRotatedSpace(BOX, -90), toRotatedSpace(BOX, 270), "-90 = 270");
  });
});

describe("redaction sanitising", () => {
  it("clamps a box that overhangs the image", () => {
    assert.deepEqual(sanitiseBox({ x: 90, y: 90, width: 50, height: 50 }), {
      x: 90,
      y: 90,
      width: 10,
      height: 10,
    });
  });

  it("drops a box with no area", () => {
    assert.equal(sanitiseBox({ x: 10, y: 10, width: 0, height: 20 }), null);
    assert.equal(sanitiseBox({ x: 100, y: 0, width: 10, height: 10 }), null);
    assert.equal(sanitiseBox(null), null);
    assert.equal(sanitiseBox({}), null);
  });

  it("refuses to let junk through as coordinates", () => {
    for (const bad of [NaN, Infinity, -Infinity, "abc", null, undefined, {}]) {
      assert.equal(clampPercent(bad), 0, `${String(bad)}`);
    }
    assert.equal(clampPercent(-10), 0);
    assert.equal(clampPercent(150), 100);
    assert.equal(clampPercent("42"), 42, "numeric strings still work");
  });
});
