import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampOffset,
  clampScale,
  fitScale,
  fitState,
  MAX_SCALE,
  MIN_SCALE,
  zoomAt,
} from "../src/lib/zoom.js";

const container = { width: 1000, height: 800 };
const portrait = { width: 553, height: 1024 };
const spread = { width: 1024, height: 955 };

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

describe("zoom: fitScale", () => {
  it("fits by the tighter axis", () => {
    // Portrait is limited by height, landscape by width.
    close(fitScale(container, portrait), 800 / 1024, "portrait fits by height");
    close(fitScale({ width: 500, height: 5000 }, spread), 500 / 1024, "fits by width");
  });

  it("shrinks an image larger than the container", () => {
    assert.ok(fitScale(container, { width: 4000, height: 3000 }) < 1);
  });

  it("also scales a small image UP to fit", () => {
    // fitScale is a ratio, not a cap. fitState is what decides whether to use
    // it, so this must report the honest number.
    assert.ok(fitScale(container, { width: 100, height: 100 }) > 1);
  });

  it("returns 1 rather than NaN when something has no size yet", () => {
    // An <img> that has not loaded reports 0x0, and NaN would poison every
    // later offset calculation.
    for (const bad of [null, undefined, { width: 0, height: 0 }]) {
      assert.equal(fitScale(container, bad), 1, JSON.stringify(bad));
      assert.equal(fitScale(bad, portrait), 1, JSON.stringify(bad));
    }
  });
});

describe("zoom: clampScale", () => {
  it("holds the limits", () => {
    assert.equal(clampScale(100), MAX_SCALE);
    assert.equal(clampScale(0.0001), MIN_SCALE);
    assert.equal(clampScale(2), 2);
  });

  it("refuses junk rather than propagating it", () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined]) {
      assert.equal(clampScale(bad), MIN_SCALE, `${bad}`);
    }
  });

  it("respects caller-supplied bounds", () => {
    assert.equal(clampScale(5, { min: 1, max: 3 }), 3);
    assert.equal(clampScale(0.5, { min: 1, max: 3 }), 1);
  });
});

describe("zoom: clampOffset", () => {
  it("centres an image smaller than the container, ignoring the drag", () => {
    const offset = clampOffset({ x: 999, y: -999 }, { container, image: portrait, scale: 0.5 });
    close(offset.x, (1000 - 553 * 0.5) / 2, "centred x");
    close(offset.y, (800 - 1024 * 0.5) / 2, "centred y");
  });

  it("never lets a larger image be dragged off the container", () => {
    const scale = 2; // 2048 x 1910, bigger than the container on both axes
    const shown = { width: spread.width * scale, height: spread.height * scale };

    // Dragged hard right/down: the top-left corner cannot go positive.
    const a = clampOffset({ x: 9999, y: 9999 }, { container, image: spread, scale });
    assert.equal(a.x, 0);
    assert.equal(a.y, 0);

    // Dragged hard left/up: the far edge cannot come inside the container.
    const b = clampOffset({ x: -9999, y: -9999 }, { container, image: spread, scale });
    close(b.x, container.width - shown.width, "right edge flush");
    close(b.y, container.height - shown.height, "bottom edge flush");
  });

  it("leaves a legitimate pan alone", () => {
    const offset = clampOffset({ x: -100, y: -50 }, { container, image: spread, scale: 2 });
    close(offset.x, -100, "x untouched");
    close(offset.y, -50, "y untouched");
  });

  it("always covers the container when the image is larger", () => {
    const scale = 3;
    for (const drag of [{ x: 500, y: 500 }, { x: -5000, y: 20 }, { x: 0, y: -1 }]) {
      const o = clampOffset(drag, { container, image: spread, scale });
      assert.ok(o.x <= 0 && o.y <= 0, `top-left not positive for ${JSON.stringify(drag)}`);
      assert.ok(
        o.x + spread.width * scale >= container.width - 1e-9 &&
          o.y + spread.height * scale >= container.height - 1e-9,
        `container covered for ${JSON.stringify(drag)}`
      );
    }
  });
});

describe("zoom: zoomAt", () => {
  /*
   * The property the whole gesture rests on: whatever pixel sits under the
   * cursor before the wheel turns must sit under it afterwards. Get this wrong
   * and the image scales about its own corner, which reads as the page sliding
   * away on its own.
   */
  const start = { scale: 1, offset: { x: -200, y: -150 } };

  for (const point of [{ x: 0, y: 0 }, { x: 500, y: 400 }, { x: 999, y: 799 }]) {
    it(`holds the point under (${point.x}, ${point.y}) still`, () => {
      const imageBefore = {
        x: (point.x - start.offset.x) / start.scale,
        y: (point.y - start.offset.y) / start.scale,
      };
      const next = zoomAt(start, point, 1.5);
      const imageAfter = {
        x: (point.x - next.offset.x) / next.scale,
        y: (point.y - next.offset.y) / next.scale,
      };
      close(imageAfter.x, imageBefore.x, "same image x under the cursor");
      close(imageAfter.y, imageBefore.y, "same image y under the cursor");
    });
  }

  it("returns to where it started after zooming in and back out", () => {
    const point = { x: 320, y: 240 };
    const inThenOut = zoomAt(zoomAt(start, point, 2), point, 0.5);
    close(inThenOut.scale, start.scale, "scale");
    close(inThenOut.offset.x, start.offset.x, "offset x");
    close(inThenOut.offset.y, start.offset.y, "offset y");
  });

  it("stops at the limits instead of running away", () => {
    let state = { scale: 1, offset: { x: 0, y: 0 } };
    for (let i = 0; i < 50; i += 1) state = zoomAt(state, { x: 500, y: 400 }, 1.5);
    assert.equal(state.scale, MAX_SCALE);

    for (let i = 0; i < 100; i += 1) state = zoomAt(state, { x: 500, y: 400 }, 0.5);
    assert.equal(state.scale, MIN_SCALE);
  });

  it("honours tighter bounds when asked", () => {
    const next = zoomAt(start, { x: 0, y: 0 }, 10, { min: 0.5, max: 2 });
    assert.equal(next.scale, 2);
  });
});

describe("zoom: fitState", () => {
  it("opens fitted and centred", () => {
    const state = fitState(container, portrait);
    close(state.scale, 800 / 1024, "fitted");
    // Fitted by height, so it is centred horizontally and flush vertically.
    close(state.offset.y, 0, "no vertical slack");
    close(state.offset.x, (1000 - 553 * state.scale) / 2, "centred horizontally");
  });

  it("survives an image that has not loaded", () => {
    const state = fitState(container, { width: 0, height: 0 });
    assert.ok(Number.isFinite(state.scale));
    assert.ok(Number.isFinite(state.offset.x) && Number.isFinite(state.offset.y));
  });
});
