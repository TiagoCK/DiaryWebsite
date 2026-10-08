/**
 * Appends new scans to the end of the diary.
 *
 *   1. Drop image files into images/incoming/
 *   2. npm run add               show the plan, change nothing
 *   3. npm run add -- --commit   upload them and file the originals away
 *
 * Overrides, when the single/spread guess is wrong:
 *   --single=a.jpg,b.jpg    force those files to count as one page
 *   --spread=c.jpg          force those files to count as two
 *   --diary=2               add to a diary other than the first
 *
 * Adding a page used to mean hand-editing MANIFEST in src/lib/pages.js with the
 * right page number, page count and exact pixel dimensions -- all of which are
 * derivable from the file. This derives them.
 *
 * Appending only. Replacing an existing page is not something this does: the
 * image editor covers rotation, cropping and bars, and re-uploading over a page
 * would discard them.
 */

import { readFile, readdir, rename, copyFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_DIARY_ID, MANIFEST, storageKeyFor } from "../src/lib/pages.js";
import { analyse, IMAGE_EXTENSIONS, nextFreePageId } from "../src/lib/ingest.js";
import { BUCKET, getSupabase } from "../src/lib/supabase.js";

const SCANS_DIR = path.join(process.cwd(), "images");
const INCOMING_DIR = path.join(SCANS_DIR, "incoming");
const MANIFEST_FILE = path.join(process.cwd(), "src", "lib", "manifest.generated.json");

const EXTENSIONS = IMAGE_EXTENSIONS;

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const forcedSingle = namesFromFlag("--single");

/**
 * Which book these scans join.
 *
 * Defaults rather than being required: this script has no request to resolve a
 * slug from, and it predates there being more than one diary. The in-app
 * uploader is the multi-diary path.
 */
const diaryId = Number(
  argv.find((a) => a.startsWith("--diary="))?.slice("--diary=".length) ?? DEFAULT_DIARY_ID
);
if (!Number.isInteger(diaryId) || diaryId < 1) {
  throw new Error("--diary must be a diary id (a positive integer).");
}
const forcedSpread = namesFromFlag("--spread");

function namesFromFlag(flag) {
  const arg = argv.find((a) => a.startsWith(`${flag}=`));
  if (!arg) return new Set();
  return new Set(
    arg
      .slice(flag.length + 1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * Numeric-aware ordering.
 *
 * A plain string sort puts "_10" before "_2", which is exactly how the original
 * batch got scrambled. Intl.Collator with numeric:true compares digit runs as
 * numbers.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Read one incoming scan and hand it to the shared pipeline.
 *
 * analyse() itself lives in src/lib/ingest.js so the in-app uploader runs the
 * identical code -- EXIF baking, the width cap, the JPEG settings and the
 * single/spread rule are all decided in one place.
 */
async function analyseFile(fileName) {
  const original = await readFile(path.join(INCOMING_DIR, fileName));

  // The flags are per filename here; ingest.js takes the resolved answer.
  let pageCountOverride;
  if (forcedSingle.has(fileName)) pageCountOverride = 1;
  if (forcedSpread.has(fileName)) pageCountOverride = 2;

  const scan = await analyse(original, { pageCountOverride });

  // The script's asterisk marks "a flag was given", not "the flag disagreed
  // with the guess", which is what ingest.js reports.
  return {
    ...scan,
    fileName,
    forced: forcedSingle.has(fileName) || forcedSpread.has(fileName),
  };
}

async function listIncoming() {
  let entries;
  try {
    entries = await readdir(INCOMING_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `No ${path.relative(process.cwd(), INCOMING_DIR)} folder yet. Create it and drop scans in.`
      );
    }
    throw error;
  }

  return entries
    .filter((e) => e.isFile() && EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort(collator.compare);
}

/** Move a processed scan into images/, where the masters live. */
async function fileAway(fileName) {
  const from = path.join(INCOMING_DIR, fileName);
  const to = path.join(SCANS_DIR, fileName);
  try {
    await rename(from, to);
  } catch (error) {
    // Different volumes cannot be renamed across.
    if (error.code !== "EXDEV") throw error;
    await copyFile(from, to);
    await unlink(from);
  }
}

async function writeManifest(entries) {
  await writeFile(MANIFEST_FILE, `${JSON.stringify(entries, null, 2)}\n`);
}

async function main() {
  const names = await listIncoming();
  if (names.length === 0) {
    console.log(
      `Nothing in ${path.relative(process.cwd(), INCOMING_DIR)}. Drop scans there and re-run.`
    );
    return;
  }

  // Everything is checked before anything is written, so a corrupt file fails
  // the plan rather than aborting a batch with some pages already uploaded.
  const existing = new Set(
    (await readdir(SCANS_DIR, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => e.name)
  );
  const clashes = names.filter((n) => existing.has(n));
  if (clashes.length) {
    throw new Error(
      `These names already exist in images/, and filing them away would overwrite a ` +
        `master:\n  ${clashes.join("\n  ")}\nRename them and re-run.`
    );
  }

  const supabase = getSupabase();
  let pageId = await nextFreePageId(supabase, diaryId);

  console.log(commit ? "COMMITTING\n" : "DRY RUN -- nothing will be written\n");

  const planned = [];
  for (const name of names) {
    const scan = await analyseFile(name);
    planned.push({ ...scan, pageId });
    pageId += scan.pageCount;
  }

  const label = (p) =>
    p.pageCount === 1 ? `p${p.pageId}` : `p${p.pageId}-${p.pageId + p.pageCount - 1}`;
  const nameWidth = Math.min(44, Math.max(...planned.map((p) => p.fileName.length)));

  for (const p of planned) {
    console.log(
      `  ${label(p).padEnd(9)} ${p.fileName.slice(0, nameWidth).padEnd(nameWidth)} ` +
        `${p.pageCount === 2 ? "spread" : "single"}${p.forced ? "*" : " "} ` +
        `${String(`${p.width}x${p.height}`).padEnd(10)} ${(p.byteSize / 1024).toFixed(0)} KB`
    );
  }
  if (planned.some((p) => p.forced)) console.log("\n  * overridden by flag");

  if (!commit) {
    console.log(
      `\n${planned.length} scan(s) would become pages ${planned[0].pageId}–` +
        `${planned.at(-1).pageId + planned.at(-1).pageCount - 1}.` +
        `\nCheck the single/spread column -- it sets the page numbering for everything` +
        `\nadded after it. Re-run with --commit to apply.`
    );
    return;
  }

  // Upload, insert and file away one scan at a time. In bulk, an interruption
  // would leave storage, the table and the folder disagreeing about how far it
  // got; per-scan, at most one file is ambiguous and the next dry run shows it.
  const added = [];
  for (const p of planned) {
    const key = storageKeyFor(p.pageId, diaryId);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(key, p.bytes, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw new Error(`Upload of ${key} failed: ${uploadError.message}`);

    const { error: rowError } = await supabase.from("pages").insert({
      diary_id: diaryId,
      page_id: p.pageId,
      storage_key: key,
      page_count: p.pageCount,
      width: p.width,
      height: p.height,
      byte_size: p.byteSize,
      // first_line is typed in later from /admin/pages.
    });
    if (rowError) throw new Error(`Row for page ${p.pageId} failed: ${rowError.message}`);

    await fileAway(p.fileName);

    added.push({
      file: p.fileName,
      // The join back to a database row. `file` means nothing to Postgres and
      // `pageId` changes whenever pages are reordered, so neither can be it.
      storageKey: key,
      pageId: p.pageId,
      pageCount: p.pageCount,
      width: p.sourceWidth,
      height: p.sourceHeight,
    });
    console.log(`  ${label(p).padEnd(9)} ${p.fileName} added`);
  }

  await writeManifest([...MANIFEST, ...added]);

  console.log(
    `\n${added.length} page entr${added.length === 1 ? "y" : "ies"} added, ` +
      `now ending at page ${planned.at(-1).pageId + planned.at(-1).pageCount - 1}.` +
      `\nOriginals moved to images/. Manifest regenerated for DIARY_SOURCE=local.` +
      `\nAdd first lines from /admin/pages when you are ready.`
  );
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
