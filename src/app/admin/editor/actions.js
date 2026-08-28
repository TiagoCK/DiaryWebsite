"use server";

import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { DIARY_ID } from "@/lib/pages";
import { BUCKET, getSupabase, originalKeyFor } from "@/lib/supabase";

const ROTATIONS = [0, 90, 180, 270];
const JPEG_QUALITY = 85;

async function loadRow(pageId) {
  const { data, error } = await getSupabase()
    .from("pages")
    .select("storage_key, original_key, width, height")
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

/**
 * Apply a rotation and crop, writing the result over the live image.
 *
 * Always derives from the pristine original, so repeated edits cost exactly one
 * re-encode from the scan as uploaded rather than compounding JPEG loss -- and a
 * crop can later be widened again.
 *
 * Order is rotate-then-crop, and the crop arrives as percentages of the ROTATED
 * image, which is what the editor draws its box on. Percentages rather than
 * pixels mean the preview's display scale can never disagree with the source
 * resolution.
 */
export async function saveImageEdit({ pageId, rotation, crop }) {
  await requireAdmin();

  const id = Number(pageId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, message: "Invalid page." };
  if (!ROTATIONS.includes(rotation)) return { ok: false, message: "Invalid rotation." };

  const row = await loadRow(id);
  if (!row) return { ok: false, message: "No such page." };

  // First edit: preserve the scan as uploaded before overwriting anything.
  let originalKey = row.original_key;
  if (!originalKey) {
    originalKey = originalKeyFor(row.storage_key);
    const pristine = await download(row.storage_key);
    const { error } = await getSupabase()
      .storage.from(BUCKET)
      .upload(originalKey, pristine, { contentType: "image/jpeg", upsert: true });
    if (error) {
      return { ok: false, message: `Could not preserve original: ${error.message}` };
    }
  }

  const source = await download(originalKey);
  const rotated = sharp(source).rotate(rotation);
  const meta = await rotated.metadata();

  // Crop geometry is never trusted: it is resolved against the real rotated
  // dimensions and clamped, so an out-of-bounds or inverted rect cannot reach
  // sharp (where it would throw) or quietly produce something unintended.
  let pipeline = rotated;
  if (crop) {
    const left = Math.round((clampPercent(crop.x) / 100) * meta.width);
    const top = Math.round((clampPercent(crop.y) / 100) * meta.height);
    const width = Math.round((clampPercent(crop.width) / 100) * meta.width);
    const height = Math.round((clampPercent(crop.height) / 100) * meta.height);

    const w = Math.min(width, meta.width - left);
    const h = Math.min(height, meta.height - top);
    if (w < 1 || h < 1) return { ok: false, message: "Crop area is empty." };

    pipeline = rotated.extract({ left, top, width: w, height: h });
  }

  const { data: bytes, info } = await pipeline
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const db = getSupabase();
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(row.storage_key, bytes, {
      contentType: "image/jpeg",
      upsert: true,
      // Short-lived: the object is overwritten in place, so a long CDN cache
      // would keep handing out the pre-edit image.
      cacheControl: "60",
    });
  if (uploadError) return { ok: false, message: uploadError.message };

  const { error: rowError } = await db
    .from("pages")
    .update({
      original_key: originalKey,
      edit_rotation: rotation,
      edit_crop: crop ?? null,
      width: info.width,
      height: info.height,
      byte_size: bytes.byteLength,
      updated_at: new Date().toISOString(),
    })
    .eq("diary_id", DIARY_ID)
    .eq("page_id", id);
  if (rowError) return { ok: false, message: rowError.message };

  revalidateEverything();
  return { ok: true, width: info.width, height: info.height };
}

/** Restore the scan as uploaded and clear the edit parameters. */
export async function revertImage({ pageId }) {
  await requireAdmin();

  const id = Number(pageId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, message: "Invalid page." };

  const row = await loadRow(id);
  if (!row?.original_key) {
    return { ok: false, message: "This page has no stored original." };
  }

  // Re-encoded rather than copied byte-for-byte so the recorded dimensions come
  // from the image itself instead of being trusted from elsewhere.
  const source = await download(row.original_key);
  const { data: bytes, info } = await sharp(source)
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const db = getSupabase();
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(row.storage_key, bytes, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "60",
    });
  if (uploadError) return { ok: false, message: uploadError.message };

  const { error: rowError } = await db
    .from("pages")
    .update({
      edit_rotation: 0,
      edit_crop: null,
      width: info.width,
      height: info.height,
      byte_size: bytes.byteLength,
      updated_at: new Date().toISOString(),
    })
    .eq("diary_id", DIARY_ID)
    .eq("page_id", id);
  if (rowError) return { ok: false, message: rowError.message };

  revalidateEverything();
  return { ok: true };
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function revalidateEverything() {
  revalidatePath("/");
  revalidatePath("/admin/editor");
  revalidatePath("/admin/pages");
}
