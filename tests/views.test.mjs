import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildViews,
  frameAspect,
  halfOf,
  initialViewIndex,
  totalPages,
  viewIndexForPage,
} from "../src/lib/views.js";

const single = (pageId) => ({ pageId, pageCount: 1, width: 500, height: 900 });
const spread = (pageId) => ({ pageId, pageCount: 2, width: 900, height: 500 });

/** The real shape: singles at 1 and 2, then twelve spreads to 26. */
function diary() {
  const pages = [single(1), single(2)];
  for (let n = 3; n <= 25; n += 2) pages.push(spread(n));
  return pages;
}

describe("views", () => {
  it("pairs two consecutive singles into one frame", () => {
    const views = buildViews([single(1), single(2)]);
    assert.equal(views.length, 1);
    assert.equal(views[0].label, "Pages 1–2");
  });

  it("gives a spread a frame of its own", () => {
    const views = buildViews([spread(1)]);
    assert.equal(views.length, 1);
    assert.equal(views[0].label, "Pages 1–2");
    assert.equal(views[0].pages.length, 1, "one image, not two");
  });

  it("leaves a trailing unpaired single on the left with a blank facing page", () => {
    const views = buildViews([spread(1), single(3)]);
    assert.equal(views.length, 2);
    assert.equal(views[1].label, "Page 3");
    assert.equal(halfOf(views[1], "left").page.pageId, 3);
    assert.equal(halfOf(views[1], "right"), null, "nothing faces it");
  });

  it("does not pair a single that is separated by a spread", () => {
    // 1 is a lone single because a spread follows; 4 is lone because nothing
    // follows. Two singles only pair when they are adjacent.
    const views = buildViews([single(1), spread(2), single(4)]);
    assert.equal(views.length, 3);
    assert.deepEqual(views.map((v) => v.label), ["Page 1", "Pages 2–3", "Page 4"]);
  });

  it("clips both halves of a spread from the same image", () => {
    const views = buildViews([spread(1)]);
    assert.equal(halfOf(views[0], "left").clip, "left");
    assert.equal(halfOf(views[0], "right").clip, "right");
    assert.equal(
      halfOf(views[0], "left").page,
      halfOf(views[0], "right").page,
      "one image, two clips"
    );
  });

  it("counts the diary in pages, not frames", () => {
    assert.equal(buildViews(diary()).length, 13);
    assert.equal(totalPages(diary()), 26);
    assert.equal(totalPages([]), 0);
  });

  it("resolves a page number to the frame that holds it", () => {
    const views = buildViews(diary());
    assert.equal(viewIndexForPage(views, 1), 0);
    assert.equal(viewIndexForPage(views, 2), 0, "both singles share a frame");
    assert.equal(viewIndexForPage(views, 3), 1);
  });

  it("resolves an INTERIOR number to its frame rather than refusing", () => {
    // Deliberately the opposite of ordering.js: reordering needs to know which
    // scan you mean, reading only needs to know which frame.
    const views = buildViews(diary());
    assert.equal(viewIndexForPage(views, 4), 1, "page 4 opens the spread at 3–4");
    assert.equal(viewIndexForPage(views, 26), 12);
  });

  it("makes every page number reachable, and every frame reachable", () => {
    const views = buildViews(diary());
    const hit = new Set();
    for (let n = 1; n <= 26; n += 1) {
      const i = viewIndexForPage(views, n);
      assert.notEqual(i, -1, `page ${n} is unreachable`);
      hit.add(i);
    }
    assert.equal(hit.size, views.length, "every frame reachable by some number");
  });

  it("returns -1 for numbers no frame holds", () => {
    const views = buildViews(diary());
    for (const n of [0, 27, -1, 2.5, NaN]) {
      assert.equal(viewIndexForPage(views, n), -1, `${n}`);
    }
    assert.equal(viewIndexForPage(buildViews([]), 1), -1, "empty diary");
  });

  it("sizes the frame from the widest view so the book never resizes", () => {
    const views = buildViews([single(1), single(2), spread(3)]);
    // Two 500x900 singles side by side are narrower than one 900x500 spread.
    assert.ok(frameAspect(views) >= 900 / 500);
    assert.equal(frameAspect([]), 1, "a sane default with nothing to measure");
  });
});

describe("views: which frame to open on", () => {
  const views = buildViews(diary());

  it("prefers an explicit link over anything remembered", () => {
    const { index, source } = initialViewIndex(views, { linkedPage: 5, rememberedPage: 21 });
    assert.equal(source, "link");
    assert.equal(index, viewIndexForPage(views, 5));
  });

  it("falls back to the remembered position when there is no link", () => {
    const { index, source } = initialViewIndex(views, { rememberedPage: 21 });
    assert.equal(source, "remembered");
    assert.equal(index, viewIndexForPage(views, 21));
  });

  it("opens at the beginning when there is neither", () => {
    assert.deepEqual(initialViewIndex(views, {}), { index: 0, source: "default" });
    assert.deepEqual(initialViewIndex(views), { index: 0, source: "default" });
  });

  it("ignores a link that no longer resolves, and uses the memory instead", () => {
    // The linked page was removed, or the URL was typed by hand. Falling
    // through beats opening a blank frame.
    const { index, source } = initialViewIndex(views, { linkedPage: 999, rememberedPage: 9 });
    assert.equal(source, "remembered");
    assert.equal(index, viewIndexForPage(views, 9));
  });

  it("ignores a remembered page that no longer exists", () => {
    // The diary shrank -- a page was deleted since this session stored 30.
    assert.deepEqual(
      initialViewIndex(views, { rememberedPage: 30 }),
      { index: 0, source: "default" }
    );
  });

  it("survives the junk that browser storage and address bars produce", () => {
    for (const junk of [null, undefined, "", "  ", "abc", "1e3", NaN, {}, [], "0", "-4", "2.5"]) {
      const result = initialViewIndex(views, { linkedPage: junk, rememberedPage: junk });
      assert.equal(result.source, "default", `linked/remembered ${JSON.stringify(junk)}`);
      assert.equal(result.index, 0);
    }
  });

  it("accepts a numeric string, because sessionStorage only stores strings", () => {
    const { index, source } = initialViewIndex(views, { rememberedPage: "21" });
    assert.equal(source, "remembered");
    assert.equal(index, viewIndexForPage(views, 21));
  });

  it("resolves an interior page number to its frame", () => {
    // Storing "the page I was on" can land on the second half of a spread.
    const { index, source } = initialViewIndex(views, { rememberedPage: 4 });
    assert.equal(source, "remembered");
    assert.equal(index, viewIndexForPage(views, 3), "same frame as page 3");
  });

  it("opens at the beginning of an empty diary without throwing", () => {
    assert.deepEqual(
      initialViewIndex(buildViews([]), { linkedPage: 1, rememberedPage: 1 }),
      { index: 0, source: "default" }
    );
  });
});
