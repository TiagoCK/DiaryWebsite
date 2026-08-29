import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";

import { analyse, MAX_WIDTH, rasterisePdf, safeFileName } from "../src/lib/ingest.js";
import {
  inkOf,
  landscape,
  notAnImage,
  oversized,
  portrait,
  threePagePdf,
  turned,
} from "./fixtures.mjs";

describe("ingest: analyse", () => {
  it("calls a portrait scan a single page", async () => {
    const scan = await analyse(await portrait());
    assert.equal(scan.pageCount, 1);
    assert.equal(scan.guessed, 1);
  });

  it("calls a landscape scan a spread", async () => {
    // An open book photographed as one image comes out wider than it is tall.
    const scan = await analyse(await landscape());
    assert.equal(scan.pageCount, 2);
  });

  it("uses DISPLAY dimensions, not stored ones, for an EXIF-rotated scan", async () => {
    // Stored 400x900 with orientation 6, so it displays 900x400 -- landscape,
    // and therefore a spread. Reading the stored dimensions would call this a
    // single and mis-number every page after it. The real diary carries both
    // orientation 6 and 8.
    const file = await turned({ width: 400, height: 900, orientation: 6 });
    const stored = await sharp(file).metadata();
    assert.equal(stored.width, 400, "fixture really is stored portrait");
    assert.equal(stored.orientation, 6, "fixture really carries the tag");

    const scan = await analyse(file);
    assert.equal(scan.sourceWidth, 900, "axes swapped");
    assert.equal(scan.sourceHeight, 400);
    assert.equal(scan.pageCount, 2, "so it is a spread");
  });

  it("bakes the orientation in so nothing downstream reinterprets it", async () => {
    const scan = await analyse(await turned());
    const out = await sharp(scan.bytes).metadata();
    assert.ok(
      out.orientation === undefined || out.orientation === 1,
      `tag should be gone, got ${out.orientation}`
    );
    assert.equal(out.width, scan.width, "reported width matches the bytes");
    assert.equal(out.height, scan.height, "reported height matches the bytes");
  });

  it("caps an oversized scan at MAX_WIDTH, keeping its aspect", async () => {
    const scan = await analyse(await oversized({ width: 4000, height: 2000 }));
    assert.equal(scan.width, MAX_WIDTH);
    assert.equal(scan.height, MAX_WIDTH / 2);
  });

  it("never enlarges a small scan", async () => {
    const scan = await analyse(await portrait({ width: 500, height: 900 }));
    assert.equal(scan.width, 500);
  });

  it("lets an override beat the guess, and records what it replaced", async () => {
    const scan = await analyse(await landscape(), { pageCountOverride: 1 });
    assert.equal(scan.pageCount, 1, "override wins");
    assert.equal(scan.guessed, 2, "guess still reported");
    assert.equal(scan.forced, true);
  });

  it("does not call an override that agrees with the guess 'forced'", async () => {
    const scan = await analyse(await landscape(), { pageCountOverride: 2 });
    assert.equal(scan.forced, false);
  });

  it("refuses something that is not an image", async () => {
    await assert.rejects(() => analyse(notAnImage()));
  });
});

describe("ingest: safeFileName", () => {
  it("takes the leaf, discarding any directory part", () => {
    assert.equal(safeFileName("../../etc/passwd"), "passwd");
    assert.equal(safeFileName(["C:", "Users", "me", "a b.jpg"].join("\\")), "a-b.jpg");
  });

  it("strips characters that have no business in a filename", () => {
    assert.equal(safeFileName("my scan (1).jpg"), "my-scan-1-.jpg");
    assert.equal(safeFileName(".hidden"), "hidden");
  });

  it("never returns an empty name", () => {
    for (const bad of ["...", "", "///", null, undefined]) {
      assert.ok(safeFileName(bad).length > 0, `${String(bad)}`);
    }
  });

  it("leaves an ordinary name alone", () => {
    assert.equal(safeFileName("memoir-2024.pdf"), "memoir-2024.pdf");
  });
});

describe("ingest: rasterisePdf", () => {
  it("renders every page, in order, one at a time", async () => {
    const seen = [];
    let live = 0;
    let mostLiveAtOnce = 0;

    const count = await rasterisePdf(threePagePdf(), {
      onPage: async (png, n, total) => {
        live += 1;
        mostLiveAtOnce = Math.max(mostLiveAtOnce, live);
        const meta = await sharp(png).metadata();
        seen.push({ n, total, ink: await inkOf(png), long: Math.max(meta.width, meta.height) });
        live -= 1;
      },
    });

    assert.equal(count, 3);
    assert.deepEqual(seen.map((s) => s.n), [1, 2, 3], "in order");
    assert.deepEqual(seen.map((s) => s.total), [3, 3, 3]);

    // Memory is the reason this streams: collecting every page of a 150-page
    // scan first meant ~450 MB live at once.
    assert.equal(mostLiveAtOnce, 1, "only one page held at a time");

    // The fixture draws one more filled square per page, so ink must rise. This
    // is what proves ORDER without reading any text back.
    assert.ok(seen[0].ink < seen[1].ink, "page 1 has less ink than page 2");
    assert.ok(seen[1].ink < seen[2].ink, "page 2 has less ink than page 3");
    assert.ok(seen[0].ink > 0, "something actually rendered");
  });

  it("scales each page so its long edge lands at MAX_WIDTH", async () => {
    const longEdges = [];
    await rasterisePdf(threePagePdf(), {
      onPage: async (png) => {
        const meta = await sharp(png).metadata();
        longEdges.push(Math.max(meta.width, meta.height));
      },
    });
    // Computed per page from that page's own size, so the landscape third page
    // lands on the same long edge as the two portrait ones.
    assert.deepEqual(longEdges, [MAX_WIDTH, MAX_WIDTH, MAX_WIDTH]);
  });

  it("hands pages to analyse() that guess correctly", async () => {
    const guesses = [];
    await rasterisePdf(threePagePdf(), {
      onPage: async (png) => guesses.push((await analyse(png)).pageCount),
    });
    assert.deepEqual(guesses, [1, 1, 2], "two portrait pages, then a landscape one");
  });

  it("enforces the page limit", async () => {
    await assert.rejects(
      () => rasterisePdf(threePagePdf(), { maxPages: 2, onPage: async () => {} }),
      /page limit/
    );
  });

  it("refuses a file that is not a PDF", async () => {
    await assert.rejects(() =>
      rasterisePdf(Buffer.from("not a pdf at all"), { onPage: async () => {} })
    );
  });

  it("propagates an error from the callback rather than swallowing it", async () => {
    await assert.rejects(
      () =>
        rasterisePdf(threePagePdf(), {
          onPage: () => {
            throw new Error("staging is full");
          },
        }),
      /staging is full/
    );
  });
});
