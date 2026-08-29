import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { stagingDir } from "../src/lib/ingest-staging.js";

/**
 * Upload staging is addressed by an id the browser sends back at commit time.
 * These ids are the one caller-supplied value that reaches a filesystem path,
 * so the guard on them is the thing worth testing.
 */
describe("staging: id validation", () => {
  const valid = "a".repeat(32);

  it("accepts a well-formed id and resolves it under the staging root", () => {
    const dir = stagingDir(valid);
    const root = path.resolve(os.tmpdir(), "diary-upload");
    assert.equal(path.dirname(path.resolve(dir)), root);
    assert.equal(path.basename(dir), valid);
  });

  const rejected = {
    "parent traversal": "../../etc",
    "bare dotdot": "..",
    "single dot": ".",
    "forward slash": "a/b",
    backslash: "a\\b",
    "absolute posix": "/etc/passwd",
    "absolute windows": "C:\\Windows",
    "too short": "abc",
    "31 characters": "0".repeat(31),
    "33 characters": "0".repeat(33),
    "non-hex characters": "z".repeat(32),
    "uppercase hex": "A".repeat(32),
    "empty string": "",
    "null byte": `${"a".repeat(31)}\0`,
    number: 12345,
    null: null,
    undefined,
    object: {},
    array: [],
  };

  for (const [label, id] of Object.entries(rejected)) {
    it(`refuses ${label}`, () => {
      // A throw, not a sanitised path: there is no legitimate caller that sends
      // one of these, so the only correct answer is to refuse rather than to
      // guess what was meant.
      assert.throws(() => stagingDir(id), /Invalid upload id/);
    });
  }

  it("cannot be walked out of even with a hex-looking prefix", () => {
    assert.throws(() => stagingDir(`${"a".repeat(30)}/..`), /Invalid upload id/);
  });
});
