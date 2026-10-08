import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * Typography wiring.
 *
 * The font config has exactly one silent failure mode: a mistyped token name.
 * `var(--font-dsiplay)` is not a CSS error -- the declaration is simply dropped
 * and the element inherits, so a heading quietly falls back to body serif and
 * looks merely slightly wrong rather than broken. Nothing in a build, a lint or
 * a render catches it. These tests do.
 *
 * Read as text rather than through a CSS parser: adding a parser dependency to
 * check for typos would cost more than the bug.
 */

const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
const fonts = await readFile(new URL("../src/lib/fonts.js", import.meta.url), "utf8");

/** Every `--font-x:` definition in the stylesheet. */
const defined = new Set([...css.matchAll(/^\s*(--font-[\w-]+)\s*:/gm)].map((m) => m[1]));

/** Every `var(--font-x)` reference in the stylesheet. */
const used = new Set([...css.matchAll(/var\(\s*(--font-[\w-]+)/g)].map((m) => m[1]));

describe("fonts: token integrity", () => {
  it("every token used is defined", () => {
    // --font-hand-loaded is the exception: next/font emits it onto <html> at
    // build time, so it is legitimately used here and defined nowhere in CSS.
    const external = new Set(["--font-hand-loaded"]);
    const dangling = [...used].filter((t) => !defined.has(t) && !external.has(t));
    assert.deepEqual(dangling, [], `undefined font tokens referenced: ${dangling}`);
  });

  it("emits the token fonts.js promises", () => {
    // The one cross-file contract: fonts.js names the variable, CSS consumes
    // it. If someone renames it on either side this catches the other half.
    assert.match(fonts, /variable:\s*"--font-hand-loaded"/);
    assert.ok(used.has("--font-hand-loaded"));
  });

  it("defines all four roles", () => {
    for (const role of ["--font-body", "--font-hand", "--font-display", "--font-mono"]) {
      assert.ok(defined.has(role), `${role} is not defined`);
    }
  });

  it("every role is actually reachable from a rule", () => {
    // A role nobody consumes is dead config that reads as if it works.
    for (const role of ["--font-body", "--font-hand", "--font-display", "--font-mono"]) {
      assert.ok(used.has(role), `${role} is defined but never used`);
    }
  });
});

describe("fonts: no font named outside the token block", () => {
  it("routes every font-family through a token", () => {
    // The whole point of the system: one place to change the answer. A literal
    // family name in a rule is an escape hatch that makes the token block a
    // lie, so it fails here rather than being discovered months later.
    const offenders = [...css.matchAll(/^\s*font-family:\s*([^;]+);/gm)]
      .map((m) => m[1].trim())
      .filter((value) => !value.startsWith("var(--font-"));
    assert.deepEqual(offenders, [], `font-family not using a token: ${offenders}`);
  });

  it("keeps the loaded face behind a serif fallback", () => {
    // If next/font fails, --font-hand should degrade to the body serif rather
    // than to the browser default.
    assert.match(css, /--font-hand:\s*var\(--font-hand-loaded\),\s*var\(--font-body\)/);
  });
});
