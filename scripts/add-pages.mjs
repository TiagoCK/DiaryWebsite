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
import sharp from "sharp";

import { DIARY_ID, MANIFEST, storageKeyFor } from "../src/lib/pages.js";
import { BUCKET, getSupabase } from "../src/lib/supabase.js";

const SCANS_DIR = path.join(process.cwd(), "images");
const INCOMING_DIR = path.join(SCANS_DIR, "incoming");
const MANIFEST_FILE = path.join(process.cwd(), "src", "lib", "manifest.generated.json");

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 85;
const EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const forcedSingle = namesFromFlag("--single");
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
 * Normalise one scan and work out what it is.
 *
 * .rotate() with no argument bakes in the file's EXIF orientation and drops the
 * tag, so nothing downstream has to interpret it. The scans in this diary carry
 * orientation 6 AND 8, so anything that strips EXIF without baking would leave
 * some spreads turned the opposite way from the rest.
 */
async function analyse(fileName) {
  const original = await readFile(path.join(INCOMING_DIR, fileName));
  const meta = await sharp(original).metadata();

  // Display dimensions of the file as it will sit in images/. metadata() reports
  // the stored dimensions, which for an EXIF-rotated scan are the wrong way
  // round -- orientations 5..8 mean a quarter turn, so they swap.
  const turned = meta.orientation >= 5 && meta.orientation <= 8;
  const sourceWidth = turned ? meta.height : meta.width;
  const sourceHeight = turned ? meta.width : meta.height;

  const pipeline = sharp(original).rotate();
  if (sourceWidth > MAX_WIDTH) pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });

  const { data, info } = await pipeline
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  // An open book photographed as one image comes out wider than it is tall; a
  // single page is portrait. This matches every scan already in the diary.
  let pageCount = sourceWidth > sourceHeight ? 2 : 1;
  if (forcedSingle.has(fileName)) pageCount = 1;
  if (forcedSpread.has(fileName)) pageCount = 2;
  const forced = forcedSingle.has(fileName) || forcedSpread.has(fileName);

  return {
    fileName,
    bytes: data,
    pageCount,
    forced,
    // For the database: what the site will actually serve.
    width: info.width,
    height: info.height,
    byteSize: data.byteLength,
    // For the manifest: the master that stays in images/, which is larger
    // whenever the upload downscaled it.
    sourceWidth,
    sourceHeight,
    originalSize: original.byteLength,
  };
}

/** The first page number not already spoken for. */
async function nextFreePageId(supabase) {
  const { data, error } = await supabase
    .from("pages")
    .select("page_id, page_count")
    .eq("diary_id", DIARY_ID)
    .order("page_id", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read existing pages: ${error.message}`);
  if (!data?.length) return 1;
  return data[0].page_id + (data[0].page_count ?? 1);
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
  let pageId = await nextFreePageId(supabase);

  console.log(commit ? "COMMITTING\n" : "DRY RUN -- nothing will be written\n");

  const planned = [];
  for (const name of names) {
    const scan = await analyse(name);
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
    const key = storageKeyFor(p.pageId);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(key, p.bytes, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw new Error(`Upload of ${key} failed: ${uploadError.message}`);

    const { error: rowError } = await supabase.from("pages").insert({
      diary_id: DIARY_ID,
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
