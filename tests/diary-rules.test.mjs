import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canSee,
  DEFAULT_VISIBILITY,
  MAX_SLUG,
  MAX_TITLE,
  normaliseVisibility,
  prepareDiary,
  slugify,
} from "../src/lib/diary-rules.js";

/** The CHECK constraint in the diaries migration, copied so drift is caught here. */
const DB_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("diaries: slugify", () => {
  it("lowercases and hyphenates", () => {
    assert.equal(slugify("First Notebook"), "first-notebook");
    assert.equal(slugify("Paris 2024"), "paris-2024");
  });

  it("strips accents rather than dropping the letter", () => {
    assert.equal(slugify("Café Journal"), "cafe-journal");
    assert.equal(slugify("Åland Diary"), "aland-diary");
  });

  it("collapses runs of punctuation and trims the ends", () => {
    assert.equal(slugify("  ...My   Notebook!!!  "), "my-notebook");
    assert.equal(slugify("a---b"), "a-b");
    assert.equal(slugify("-leading and trailing-"), "leading-and-trailing");
  });

  it("returns empty when there is nothing usable", () => {
    for (const junk of ["", "   ", "!!!", "日記", null, undefined]) {
      assert.equal(slugify(junk), "", JSON.stringify(junk));
    }
  });

  it("never exceeds the length limit, and never ends on a hyphen", () => {
    const long = slugify("word ".repeat(40));
    assert.ok(long.length <= MAX_SLUG, `got ${long.length}`);
    assert.ok(!long.endsWith("-"), long);
  });

  it("always produces something the database will accept", () => {
    const titles = [
      "First Notebook",
      "Café 2024",
      "  spaced  out  ",
      "Numbers 123",
      "a",
      "Hyphen-Already",
      "word ".repeat(40),
    ];
    for (const t of titles) {
      const s = slugify(t);
      assert.match(s, DB_SLUG_PATTERN, `${JSON.stringify(t)} -> ${JSON.stringify(s)}`);
    }
  });
});

describe("diaries: prepareDiary", () => {
  it("derives the address from the title when none is given", () => {
    const r = prepareDiary({ title: "Paris 2024" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.diary, { title: "Paris 2024", slug: "paris-2024", subtitle: null });
  });

  it("prefers an address the admin typed", () => {
    const r = prepareDiary({ title: "Paris 2024", slug: "trip" });
    assert.equal(r.diary.slug, "trip");
  });

  it("cleans up a typed address rather than rejecting it", () => {
    // Someone types "My Trip!" into the address box; take the intent.
    assert.equal(prepareDiary({ title: "x", slug: "My Trip!" }).diary.slug, "my-trip");
  });

  it("keeps the title as typed, only trimming it", () => {
    assert.equal(prepareDiary({ title: "  Café Journal  " }).diary.title, "Café Journal");
  });

  it("stores an empty subtitle as null, not an empty string", () => {
    assert.equal(prepareDiary({ title: "x", subtitle: "   " }).diary.subtitle, null);
    assert.equal(prepareDiary({ title: "x", subtitle: " 1998–2001 " }).diary.subtitle, "1998–2001");
  });

  it("requires a title", () => {
    for (const bad of ["", "   ", null, undefined]) {
      const r = prepareDiary({ title: bad });
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.match(r.message, /title is required/i);
    }
  });

  it("refuses a title too long to store", () => {
    const r = prepareDiary({ title: "x".repeat(MAX_TITLE + 1) });
    assert.equal(r.ok, false);
    assert.match(r.message, /too long/i);
  });

  it("explains itself when a title yields no usable address", () => {
    // A title with no latin letters or digits cannot become a URL segment.
    const r = prepareDiary({ title: "日記" });
    assert.equal(r.ok, false);
    assert.match(r.message, /address/i);
  });

  it("never returns a slug the database would reject", () => {
    const cases = [
      { title: "Normal Title" },
      { title: "x", slug: "UPPER CASE" },
      { title: "x", slug: "  spaced  " },
      { title: "x", slug: "trailing---" },
      { title: "Café" },
    ];
    for (const c of cases) {
      const r = prepareDiary(c);
      assert.equal(r.ok, true, JSON.stringify(c));
      assert.match(r.diary.slug, DB_SLUG_PATTERN, JSON.stringify(c));
    }
  });
});

describe("diaries: canSee", () => {
  const admin = { isAdmin: true };
  const reader = { isAdmin: false };

  const open = { visibility: "public" };
  const members = { visibility: "readers" };
  const hidden = { visibility: "admins" };

  /*
   * The whole grid, explicitly. canSee() is checked from five surfaces and is
   * the only thing standing between an anonymous request and a private volume,
   * so every cell is worth a row rather than a clever loop.
   */
  const GRID = [
    // visibility,  no viewer, reader, admin
    ["public", open, true, true, true],
    ["readers", members, false, true, true],
    ["admins", hidden, false, false, true],
  ];

  for (const [label, diary, anon, asReader, asAdmin] of GRID) {
    it(`${label}: anonymous ${anon}, reader ${asReader}, admin ${asAdmin}`, () => {
      assert.equal(canSee(diary, null), anon, `${label} / anonymous`);
      assert.equal(canSee(diary, reader), asReader, `${label} / reader`);
      assert.equal(canSee(diary, admin), asAdmin, `${label} / admin`);
    });
  }

  /*
   * The three assertions this change exists to protect. Anonymous requests now
   * reach the pages so a public volume can be read without an account; before
   * that, canSee returned true for anything not marked `admins`, which would
   * have handed a stranger every readers volume.
   */
  it("never lets an anonymous viewer past anything but public", () => {
    assert.equal(canSee(members, null), false);
    assert.equal(canSee(hidden, null), false);
    assert.equal(canSee({}, null), false);
    assert.equal(canSee({ visibility: null }, null), false);
    assert.equal(canSee({ visibility: "something-new" }, null), false);
  });

  it("treats an empty object as no viewer, not as a signed-in one", () => {
    // getAuthState() returns { user: null }, never {}. But a call site that
    // passed the wrong thing must not thereby gain access.
    assert.equal(canSee(hidden, {}), false);
    assert.equal(canSee(members, {}), true, "an object is a viewer, if a weak one");
  });

  it("does not treat a truthy non-admin role as admin", () => {
    for (const viewer of [{ isAdmin: "yes" }, { isAdmin: 1 }, { role: "admin" }]) {
      assert.equal(canSee(hidden, viewer), false, JSON.stringify(viewer));
    }
  });

  it("treats a missing visibility as readers, not as public", () => {
    // A row from before the migration, or select("*") on a database that has
    // not run it yet. It must still be readable to a signed-in viewer --
    // vanishing from every shelf would be the worse failure -- but it must not
    // become world-readable by default.
    assert.equal(canSee({}, reader), true);
    assert.equal(canSee({ visibility: null }, reader), true);
    assert.equal(canSee({ visibility: "something-new" }, reader), true);
    assert.equal(canSee({}, null), false);
  });

  it("refuses a missing diary", () => {
    assert.equal(canSee(null, admin), false);
    assert.equal(canSee(undefined, admin), false);
    assert.equal(canSee(null, null), false);
  });
});

describe("diaries: normaliseVisibility", () => {
  it("accepts the values the database allows", () => {
    assert.equal(normaliseVisibility("public"), "public");
    assert.equal(normaliseVisibility("readers"), "readers");
    assert.equal(normaliseVisibility("admins"), "admins");
  });

  it("falls back to readers for anything else", () => {
    // "PUBLIC" stays junk on purpose: the comparison is exact, so a
    // differently-cased value from a hand-built request cannot make a volume
    // world-readable by near-miss.
    for (const junk of ["", "  ", "PUBLIC", "ADMINS", "publ", null, undefined, 7, {}]) {
      assert.equal(normaliseVisibility(junk), DEFAULT_VISIBILITY, JSON.stringify(junk));
    }
  });

  it("never normalises junk to public", () => {
    // The fallback is the one that governs a forgotten form field, so it must
    // be the private-by-default value.
    assert.notEqual(DEFAULT_VISIBILITY, "public");
  });
});
