"use server";

import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { DIARY_ID } from "@/lib/pages";
import { clampPercent, sanitiseBox } from "@/lib/redaction";
import { BUCKET, getSupabase, originalKeyFor } from "@/lib/supabase";

const ROTATIONS = [0, 90, 180, 270];
const JPEG_QUALITY = 85;
const MAX_BARS = 50;

async function loadRow(pageId) {
  const { data, error } = await getSupabase()
    .from("pages")
    // "*" so a missing column degrades to a default instead of throwing. Writes
    // that genuinely need the column still fail, but with a clear message from
    // the one admin action involved rather than taking the whole site down.
    .select("*")
    .eq("diary_id", DIARY_ID)
    .eq("page_id", pageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function download(key) {
  const { data, error } = await getSupabase().storage.from(BUCKET).download(key);
  if (error) throw new Error(`Could not read ${key}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Ensure a pristine original exists, and return its key. */
async function ensureOriginal(row) {
  if (row.original_key) return row.original_key;

  const key = originalKeyFor(row.storage_key);
  const pristine = await download(row.storage_key);
  const { error } = await getSupabase()
    .storage.from(BUCKET)
    .upload(key, pristine, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Could not preserve original: ${error.message}`);
  return key;
}

/**
 * Regenerate the published image from the pristine original.
 *
 * The order is fixed and load-bearing: bars are applied to the ORIGINAL first,
 * then rotation, then crop. Applying them last -- to the already rotated and
 * cropped output -- would mean a stored box covering different content the
 * moment the geometry changed, which for a censor bar is a leak, not a
 * cosmetic slip. Applied first, the bars rotate and crop along with the content
 * they cover.
 *
 * Every write path funnels through here, so rotating or cropping a redacted
 * page can never republish it uncensored: the bars are re-applied each time.
 *
 * The original itself is never modified. Admins can still see what a bar covers
 * via /api/admin/original; readers only ever get this output.
 */
async function publish(row, { rotation, crop, boxes }) {
  const originalKey = await ensureOriginal(row);
  const source = await download(originalKey);

  const base = await sharp(source).metadata();
  let pipeline = sharp(source);

  const usable = (boxes ?? []).map(sanitiseBox).filter(Boolean);
  if (usable.length > 0) {
    const overlays = usable
      .map((box) => {
        const left = Math.round((box.x / 100) * base.width);
        const top = Math.round((box.y / 100) * base.height);
        const width = Math.min(Math.round((box.width / 100) * base.width), base.width - left);
        const height = Math.min(
          Math.round((box.height / 100) * base.height),
          base.height - top
        );
        if (width < 1 || height < 1) return null;
        return {
          input: { create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } },
          left,
          top,
        };
      })
      .filter(Boolean);

    if (overlays.length > 0) {
      // Composited in its own pass, handed on as raw pixels. sharp orders some
      // operations internally rather than by call order, so chaining composite
      // straight into rotate would risk the bars being placed against the wrong
      // orientation. Raw rather than a re-encode keeps this lossless.
      const { data, info } = await sharp(source)
        .composite(overlays)
        .raw()
        .toBuffer({ resolveWithObject: true });
      pipeline = sharp(data, {
        raw: { width: info.width, height: info.height, channels: info.channels },
      });
    }
  }

  pipeline = pipeline.rotate(rotation);

  if (crop) {
    // Derived, not read back from the pipeline. sharp's metadata() describes the
    // INPUT image and ignores queued operations, so asking it after .rotate()
    // returns the pre-rotation dimensions -- which for a quarter turn are the
    // wrong way round, and extract() then fails with "bad extract area". A
    // quarter turn simply swaps them.
    const turned = rotation === 90 || rotation === 270;
    const rotatedWidth = turned ? base.height : base.width;
    const rotatedHeight = turned ? base.width : base.height;

    const left = Math.round((clampPercent(crop.x) / 100) * rotatedWidth);
    const top = Math.round((clampPercent(crop.y) / 100) * rotatedHeight);
    const width = Math.min(
      Math.round((clampPercent(crop.width) / 100) * rotatedWidth),
      rotatedWidth - left
    );
    const height = Math.min(
      Math.round((clampPercent(crop.height) / 100) * rotatedHeight),
      rotatedHeight - top
    );
    if (width < 1 || height < 1) throw new Error("Crop area is empty.");
    pipeline = pipeline.extract({ left, top, width, height });
  }

  const { data: bytes, info } = await pipeline
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const { error } = await getSupabase()
    .storage.from(BUCKET)
    .upload(row.storage_key, bytes, {
      contentType: "image/jpeg",
      upsert: true,
      // Short: the object is overwritten in place, and for a page that has just
      // gained a bar a stale cached copy is an uncensored copy.
      cacheControl: "0",
    });
  if (error) throw new Error(error.message);

  return { originalKey, width: info.width, height: info.height, byteSize: bytes.byteLength };
}

/**
 * Set rotation and crop, keeping any existing bars.
 *
 * Geometry is re-derived from the pristine original every time, so repeated
 * edits cost one re-encode from the scan as uploaded rather than compounding
 * JPEG loss, and a crop can later be widened again.
 */
export async function saveImageEdit({ pageId, rotation, crop }) {
  await requireAdmin();

  const id = Number(pageId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, message: "Invalid page." };
  if (!ROTATIONS.includes(rotation)) return { ok: false, message: "Invalid rotation." };

  const row = await loadRow(id);
  if (!row) return { ok: false, message: "No such page." };

  // A crop that was sent but has no usable area is an error, not a request to
  // publish uncropped: silently dropping it would discard a crop the admin had
  // already saved while still reporting success.
  const cleanCrop = crop ? sanitiseBox(crop) : null;
  if (crop && !cleanCrop) return { ok: false, message: "Crop area is empty." };

  try {
    const result = await publish(row, {
      rotation,
      crop: cleanCrop,
      // Carried through: dropping them here would republish the page uncensored.
      boxes: row.redaction_boxes ?? [],
    });
    await writeRow(id, {
      original_key: result.originalKey,
      edit_rotation: rotation,
      edit_crop: cleanCrop,
      width: result.width,
      height: result.height,
      byte_size: result.byteSize,
      updated_at: new Date().toISOString(),
    });
    return { ok: true, width: result.width, height: result.height };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

/**
 * Replace the page's redaction bars.
 *
 * Boxes arrive in ORIGINAL coordinates (the editor converts from whatever
 * rotation it is displaying). Passing an empty list removes every bar and
 * republishes the page uncensored -- deliberate, and the reason the original is
 * kept rather than destroyed.
 */
export async function setRedactionBoxes({ pageId, boxes }) {
  await requireAdmin();

  const id = Number(pageId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, message: "Invalid page." };
  if (!Array.isArray(boxes)) return { ok: false, message: "Invalid bars." };
  if (boxes.length > MAX_BARS) {
    return { ok: false, message: `At most ${MAX_BARS} bars.` };
  }

  const clean = boxes.map(sanitiseBox).filter(Boolean);
  if (boxes.length > 0 && clean.length === 0) {
    return { ok: false, message: "Those bars have no usable area." };
  }

  const row = await loadRow(id);
  if (!row) return { ok: false, message: "No such page." };

  try {
    const result = await publish(row, {
      rotation: row.edit_rotation ?? 0,
      crop: row.edit_crop ?? null,
      boxes: clean,
    });
    await writeRow(id, {
      original_key: result.originalKey,
      redaction_boxes: clean.length ? clean : null,
      redacted_at: clean.length ? new Date().toISOString() : null,
      width: result.width,
      height: result.height,
      byte_size: result.byteSize,
      updated_at: new Date().toISOString(),
    });
    return { ok: true, bars: clean.length };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

/** Clear rotation and cropping. Bars are kept -- removing those is separate. */
export async function revertImage({ pageId }) {
  await requireAdmin();

  const id = Number(pageId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, message: "Invalid page." };

  const row = await loadRow(id);
  if (!row?.original_key) {
    return { ok: false, message: "This page has no stored original." };
  }

  try {
    const result = await publish(row, {
      rotation: 0,
      crop: null,
      boxes: row.redaction_boxes ?? [],
    });
    await writeRow(id, {
      edit_rotation: 0,
      edit_crop: null,
      width: result.width,
      height: result.height,
      byte_size: result.byteSize,
      updated_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function writeRow(pageId, patch) {
  const { error } = await getSupabase()
    .from("pages")
    .update(patch)
    .eq("diary_id", DIARY_ID)
    .eq("page_id", pageId);
  if (error) throw new Error(error.message);
  revalidateEverything();
}

function revalidateEverything() {
  revalidatePath("/");
  revalidatePath("/admin/editor");
  revalidatePath("/admin/pages");
}
