/**
 * Uploads diary scans to Supabase Storage and seeds the `pages` table.
 *
 *   npm run upload -- --dry-run    show what would happen, change nothing
 *   npm run upload -- --commit     do it
 *
 * Safe to re-run: storage objects are overwritten in place and rows are upserted
 * on (diary_id, page_id), so a partial upload is repaired rather than doubled.
 *
 * Run the migration in supabase/migrations/0001_init.sql first -- this script
 * writes rows, it does not create the table.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { DIARY_ID, MANIFEST, storageKeyFor } from "../src/lib/pages.js";
import { BUCKET, getSupabase } from "../src/lib/supabase.js";

const SCANS_DIR = path.join(process.cwd(), "images");
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 85;

const args = new Set(process.argv.slice(2));
const commit = args.has("--commit");
const dryRun = args.has("--dry-run") || !commit;

/**
 * Normalise one scan.
 *
 * .rotate() with no argument applies the file's EXIF orientation and drops the
 * tag. This is the whole reason the script re-encodes: these scans carry
 * orientation 6 AND 8, so any later step that strips EXIF without baking the
 * rotation in would leave some spreads turned the opposite way from the rest.
 * Afterwards the stored bytes need no EXIF interpretation by anyone.
 */
async function normalise(file) {
  const original = await readFile(path.join(SCANS_DIR, file));
  const pipeline = sharp(original).rotate();

  const { width } = await pipeline.metadata();
  if (width > MAX_WIDTH) pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });

  const { data, info } = await pipeline
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    bytes: data,
    width: info.width,
    height: info.height,
    byteSize: data.byteLength,
    originalSize: original.byteLength,
  };
}

async function ensureBucket(supabase) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`Could not list buckets: ${error.message}`);

  const existing = buckets.find((b) => b.name === BUCKET);
  if (existing) {
    if (existing.public) {
      throw new Error(
        `Bucket "${BUCKET}" is PUBLIC. These are private diary scans -- make it ` +
          `private in the Supabase dashboard before uploading.`
      );
    }
    console.log(`bucket "${BUCKET}": exists, private \u2713`);
    return;
  }

  if (dryRun) {
    console.log(`bucket "${BUCKET}": would create (private)`);
    return;
  }
  const { error: createError } = await supabase.storage.createBucket(BUCKET, { public: false });
  if (createError) throw new Error(`Could not create bucket: ${createError.message}`);
  console.log(`bucket "${BUCKET}": created (private) \u2713`);
}

async function main() {
  console.log(dryRun ? "DRY RUN -- nothing will be written\n" : "COMMITTING\n");

  const supabase = getSupabase();
  await ensureBucket(supabase);
  console.log();

  const rows = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const page of MANIFEST) {
    const image = await normalise(page.file);
    const key = storageKeyFor(page.pageId);

    // The manifest dimensions were verified by hand against every file; if
    // sharp disagrees, one of the two is wrong and the row would be built on
    // bad data.
    if (image.width !== page.width || image.height !== page.height) {
      throw new Error(
        `${page.file}: manifest says ${page.width}x${page.height} but the ` +
          `rotated image is ${image.width}x${image.height}.`
      );
    }

    totalBefore += image.originalSize;
    totalAfter += image.byteSize;

    if (commit) {
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(key, image.bytes, { contentType: "image/jpeg", upsert: true });
      if (uploadError) throw new Error(`Upload of ${key} failed: ${uploadError.message}`);
    }

    rows.push({
      diary_id: DIARY_ID,
      page_id: page.pageId,
      storage_key: key,
      page_count: page.pageCount,
      width: image.width,
      height: image.height,
      byte_size: image.byteSize,
      // first_line stays null -- typed in by hand in the Supabase table editor.
    });

    const span =
      page.pageCount === 1 ? `p${page.pageId}` : `p${page.pageId}-${page.pageId + 1}`;
    console.log(
      `  ${span.padEnd(8)} ${key.padEnd(18)} ${image.width}x${image.height}`.padEnd(52) +
        `${(image.byteSize / 1024).toFixed(0)} KB` +
        (commit ? " uploaded" : "")
    );
  }

  if (commit) {
    const { error } = await supabase
      .from("pages")
      .upsert(rows, { onConflict: "diary_id,page_id" });
    if (error) throw new Error(`Row upsert failed: ${error.message}`);
  }

  console.log(
    `\n${rows.length} pages | ${(totalBefore / 1048576).toFixed(2)} MB in, ` +
      `${(totalAfter / 1048576).toFixed(2)} MB out`
  );
  console.log(
    commit
      ? "Done. Rows upserted."
      : "Nothing written. Re-run with --commit to upload."
  );
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
