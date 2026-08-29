import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildOrder,
  classifyTarget,
  describeSpan,
  lastPageNumber,
  projectSpans,
  reorderedKeys,
} from "../src/lib/ordering.js";

/**
 * The diary as it actually is: two single pages, then twelve spreads, covering
 * pages 1-26. Half the page numbers are therefore the second half of a spread,
 * which is what makes the "interior" case the common one rather than an edge.
 */
function diary() {
  const pages = [
    { pageId: 1, pageCount: 1, storageKey: "k1" },
    { pageId: 2, pageCount: 1, storageKey: "k2" },
  ];
  for (let n = 3; n <= 25; n += 2) pages.push({ pageId: n, pageCount: 2, storageKey: `k${n}` });
  return pages;
}

/** Every page number covered exactly once, starting at 1 -- the invariant. */
function coverage(spans) {
  const covered = spans.flatMap((s) =>
    Array.from({ length: s.pageCount }, (_, i) => s.start + i)
  );
  return {
    count: covered.length,
    distinct: new Set(covered).size,
    min: Math.min(...covered),
    max: Math.max(...covered),
  };
}

describe("ordering", () => {
  it("spans the whole diary", () => {
    assert.equal(buildOrder(diary()).length, 14);
    assert.equal(lastPageNumber(diary()), 26);
  });

  it("treats the first number of a scan as targetable", () => {
    assert.equal(classifyTarget(diary(), 3).kind, "start");
  });

  it("refuses a number inside a spread, naming the scan that owns it", () => {
    const found = classifyTarget(diary(), 4);
    assert.equal(found.kind, "interior");
    assert.equal(found.owner.start, 3);
    assert.equal(describeSpan(found.owner), "pages 3–4");
  });

  it("reports interior numbers as the common case, not the exception", () => {
    const kinds = [];
    for (let n = 1; n <= 26; n += 1) kinds.push(classifyTarget(diary(), n).kind);
    assert.equal(kinds.filter((k) => k === "interior").length, 12);
  });

  it("refuses numbers outside the diary", () => {
    for (const n of [0, -3, 27, 999]) {
      assert.equal(classifyTarget(diary(), n).kind, "out-of-range", `page ${n}`);
    }
    assert.equal(classifyTarget(diary(), 27).max, 26);
  });

  it("refuses non-integers", () => {
    for (const n of [2.5, NaN, Infinity]) {
      assert.equal(classifyTarget(diary(), n).kind, "invalid", `${n}`);
    }
  });

  it("swaps two same-size scans without disturbing anything else", () => {
    const spans = projectSpans(diary(), reorderedKeys(diary(), 5, 7));
    assert.equal(spans.find((s) => s.storageKey === "k7").start, 5);
    assert.equal(spans.find((s) => s.storageKey === "k5").start, 7);
    assert.equal(spans.find((s) => s.storageKey === "k9").start, 9, "later scans unmoved");
    assert.equal(spans.find((s) => s.storageKey === "k3").start, 3, "earlier scans unmoved");
  });

  it("keeps numbering dense when the two scans are different sizes", () => {
    // A single swapped with a spread cannot land on the number asked for; the
    // requirement is that the result has no gap and no overlap.
    const spans = projectSpans(diary(), reorderedKeys(diary(), 1, 3));
    assert.deepEqual(coverage(spans), { count: 26, distinct: 26, min: 1, max: 26 });
  });

  it("reports where a different-size move actually landed", () => {
    // Asked for page 3, lands on 4, because the spread that moved to the front
    // occupies two numbers. The action surfaces this rather than hiding it.
    const spans = projectSpans(diary(), reorderedKeys(diary(), 1, 3));
    assert.equal(spans.find((s) => s.storageKey === "k3").start, 1);
    assert.equal(spans.find((s) => s.storageKey === "k1").start, 4);
  });

  it("stays dense after a same-size swap too", () => {
    const spans = projectSpans(diary(), reorderedKeys(diary(), 5, 7));
    assert.deepEqual(coverage(spans), { count: 26, distinct: 26, min: 1, max: 26 });
  });

  it("returns null for a page it does not know", () => {
    assert.equal(reorderedKeys(diary(), 999, 3), null);
    assert.equal(reorderedKeys(diary(), 3, 999), null);
  });

  it("describes single pages and spreads differently", () => {
    assert.equal(describeSpan({ start: 4, end: 4 }), "page 4");
    assert.equal(describeSpan({ start: 3, end: 4 }), "pages 3–4");
  });

  it("handles an empty diary", () => {
    assert.equal(lastPageNumber([]), 0);
    assert.equal(classifyTarget([], 1).kind, "out-of-range");
  });
});
