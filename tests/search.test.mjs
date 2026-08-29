import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coverage, fold, highlight, matchesQuery, searchPages } from "../src/lib/search.js";

const pages = [
  { pageId: 1, firstLine: "Just Landed - 25 fantastic." },
  { pageId: 5, firstLine: "electrical engi student" },
  { pageId: 7, firstLine: null },
  { pageId: 9, firstLine: "Café by the river" },
];

describe("search: fold", () => {
  /*
   * The property everything else rests on. highlight() finds matches in the
   * FOLDED text and slices the ORIGINAL at those offsets, so folding must be a
   * one-character-for-one-character mapping. normalize("NFD") over a whole
   * string is not: "é" becomes two code points and every later offset shifts,
   * which would mark the wrong letters.
   */
  const samples = [
    "electrical engi student",
    "café naïve résumé",
    "Straße", // sharp s: no decomposition
    "İstanbul", // dotted capital I: lowercases to two code units
    "ﬁne", // fi ligature
    "weiß Äpfel Öl",
    "emoji 😀 ok", // astral pair
    "é́", // already-decomposed combining mark
    "",
    "   ",
  ];

  for (const sample of samples) {
    it(`preserves length: ${JSON.stringify(sample)}`, () => {
      assert.equal(fold(sample).length, sample.length);
    });
  }
});

describe("search: matching", () => {
  it("matches a substring, case-insensitively", () => {
    assert.equal(matchesQuery("electrical engi student", "electr"), true);
    assert.equal(matchesQuery("Just Landed - 25 fantastic.", "LANDED"), true);
  });

  it("ANDs the terms, in any order", () => {
    assert.equal(matchesQuery("electrical engi student", "student electrical"), true);
    assert.equal(matchesQuery("electrical engi student", "electrical banana"), false);
  });

  it("ignores accents in both directions", () => {
    assert.equal(matchesQuery("café society", "cafe"), true);
    assert.equal(matchesQuery("cafe society", "café"), true);
  });

  it("matches NOTHING for a blank query, rather than everything", () => {
    // An empty search box must show no results, not the whole diary.
    assert.equal(matchesQuery("anything", ""), false);
    assert.equal(matchesQuery("anything", "   "), false);
    assert.deepEqual(searchPages(pages, "  "), []);
  });

  it("never matches a page with no first line", () => {
    for (const text of [null, undefined, ""]) {
      assert.equal(matchesQuery(text, "a"), false);
    }
    assert.ok(searchPages(pages, "e").every((p) => p.firstLine));
  });

  it("returns matches in reading order", () => {
    assert.deepEqual(searchPages(pages, "a").map((p) => p.pageId), [1, 5, 9]);
    assert.deepEqual(searchPages(pages, "cafe").map((p) => p.pageId), [9]);
  });

  it("reports how much of the diary is searchable at all", () => {
    assert.deepEqual(coverage(pages), { filled: 3, total: 4, blank: 1 });
  });
});

describe("search: highlight", () => {
  const cases = [
    ["electrical engi student", "engi"],
    ["café naïve résumé", "naive"],
    ["Just Landed - 25 fantastic.", "landed 25"],
    ["Straße İstanbul 😀", "istanbul"],
    ["no match here", "zzz"],
    ["anything", ""],
  ];

  for (const [text, query] of cases) {
    it(`rejoins to exactly the original: ${JSON.stringify(text)}`, () => {
      const segments = highlight(text, query);
      assert.equal(segments.map((s) => s.text).join(""), text);
    });
  }

  it("marks the right letters after an accented character", () => {
    assert.deepEqual(
      highlight("café society", "society").filter((s) => s.hit).map((s) => s.text),
      ["society"]
    );
  });

  it("marks the accented original when the query is unaccented", () => {
    assert.deepEqual(
      highlight("Café by the river", "cafe").filter((s) => s.hit).map((s) => s.text),
      ["Café"]
    );
  });

  it("marks the right letters after a DECOMPOSED accent", () => {
    // "é" written as e + U+0301 rather than as one precomposed character --
    // what macOS filenames and some input methods produce. This is the case a
    // whole-string normalize("NFD") fold gets wrong: it would shorten the text
    // before the match, shifting every offset after it, and the highlight would
    // land on the wrong letters. Precomposed accents happen to survive that
    // bug, so without this case it would slip through.
    const text = "éclair and test";
    assert.deepEqual(
      highlight(text, "test").filter((s) => s.hit).map((s) => s.text),
      ["test"]
    );
    assert.equal(highlight(text, "test").map((s) => s.text).join(""), text);
  });

  it("marks the right letters after an astral emoji", () => {
    assert.deepEqual(
      highlight("a 😀 bcd", "bcd").filter((s) => s.hit).map((s) => s.text),
      ["bcd"]
    );
  });

  it("merges overlapping terms instead of nesting them", () => {
    assert.deepEqual(highlight("heart", "art hear"), [{ text: "heart", hit: true }]);
  });

  it("marks every occurrence of a repeated term", () => {
    assert.equal(highlight("the cat and the hat", "the").filter((s) => s.hit).length, 2);
  });

  it("returns one plain segment when nothing matches", () => {
    assert.deepEqual(highlight("no match here", "zzz"), [{ text: "no match here", hit: false }]);
    assert.deepEqual(highlight("anything", ""), [{ text: "anything", hit: false }]);
    assert.deepEqual(highlight(null, "a"), []);
  });
});
