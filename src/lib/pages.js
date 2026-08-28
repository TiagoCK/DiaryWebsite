/**
 * Data access for diary pages.
 *
 * This module is the seam between the viewer and wherever the scans live.
 * Two sources are supported, chosen by the DIARY_SOURCE environment variable:
 *
 *   supabase (default)  page rows from Postgres, images from private Storage
 *   local               the manifest below, images streamed from images/
 *
 * The switch is explicit rather than an automatic fallback: a Supabase free-tier
 * project pauses after about a week of inactivity, and silently serving stale
 * local data in that case would be far more confusing than a loud failure.
 */

const SCAN_PREFIX = "1787802885506-91ca7dc4-4c02-4bfc-8f87-fb08cb631c08_";

/** Which backing store to read from. */
export const DIARY_SOURCE = process.env.DIARY_SOURCE === "local" ? "local" : "supabase";

/** Diary volume. Multiple diaries share one table, keyed by (diary_id, page_id). */
export const DIARY_ID = 1;

/**
 * The local scans, in order.
 *
 *   pageId    first physical page number this scan covers
 *   pageCount 1 for a single page, 2 for an open spread
 *   width     DISPLAY dimensions, already EXIF-corrected
 *   height
 *
 * Every spread here carries an EXIF orientation of 6 or 8, so its stored JPEG
 * dimensions are portrait while it displays landscape. The numbers below are
 * the displayed ones. Browsers rotate automatically; anything server-side must
 * call sharp().rotate() or three of these come out opposite the rest.
 *
 * Order is explicit rather than derived from filenames: both batches end in
 * digits, so sorting on the trailing number alone interleaves them.
 *
 * This doubles as the seed for scripts/upload.mjs -- it was verified against
 * every file, so the upload reuses it rather than re-deriving it.
 */
export const MANIFEST = [
  { file: "pg1.jpg", pageId: 1, pageCount: 1, width: 553, height: 1024 },
  { file: "pg2.jpg", pageId: 2, pageCount: 1, width: 631, height: 1024 },
  { file: "pg3.jpg", pageId: 3, pageCount: 2, width: 1024, height: 878 },
  { file: `${SCAN_PREFIX}1.jpg`, pageId: 5, pageCount: 2, width: 1024, height: 955 },
  { file: `${SCAN_PREFIX}2.jpg`, pageId: 7, pageCount: 2, width: 1024, height: 885 },
  { file: `${SCAN_PREFIX}3.jpg`, pageId: 9, pageCount: 2, width: 1024, height: 950 },
  { file: `${SCAN_PREFIX}4.jpg`, pageId: 11, pageCount: 2, width: 1024, height: 955 },
  { file: `${SCAN_PREFIX}5.jpg`, pageId: 13, pageCount: 2, width: 1024, height: 885 },
  { file: `${SCAN_PREFIX}6.jpg`, pageId: 15, pageCount: 2, width: 1024, height: 955 },
  { file: `${SCAN_PREFIX}7.jpg`, pageId: 17, pageCount: 2, width: 1024, height: 885 },
  { file: `${SCAN_PREFIX}8.jpg`, pageId: 19, pageCount: 2, width: 1024, height: 885 },
  { file: `${SCAN_PREFIX}9.jpg`, pageId: 21, pageCount: 2, width: 1024, height: 866 },
  { file: `${SCAN_PREFIX}10.jpg`, pageId: 23, pageCount: 2, width: 1024, height: 903 },
  { file: `${SCAN_PREFIX}11.jpg`, pageId: 25, pageCount: 2, width: 1024, height: 903 },
];

/** Storage object key for a page. Zero-padded so keys sort in reading order. */
export function storageKeyFor(pageId, diaryId = DIARY_ID) {
  return `diary${diaryId}/${String(pageId).padStart(4, "0")}.jpg`;
}

/** The local file backing a page number, or undefined. Used by the scan route. */
export function findLocalPage(pageId) {
  return MANIFEST.find((page) => page.pageId === pageId);
}

/**
 * URL for a page's image.
 *
 * Deliberately synchronous and deliberately not a storage URL. Minting a signed
 * Supabase URL is async and the result expires, so returning one here would make
 * buildViews() async and push changes up into the viewer. Routing through our
 * own endpoint keeps this a pure function, mints signed URLs only for pages
 * someone actually looks at, and keeps storage keys out of the browser.
 */
export function getPageImageUrl(page) {
  // ?v= changes whenever the image is edited. Without it an edited scan can be
  // served from a cache that still holds the previous bytes under the same URL.
  const version = page.updatedAt ? Date.parse(page.updatedAt) : 0;
  return version ? `/api/scan/${page.pageId}?v=${version}` : `/api/scan/${page.pageId}`;
}

/** Ordered page records. Metadata only -- no image bytes. */
export async function getPages() {
  const rows = DIARY_SOURCE === "local" ? readLocalPages() : await readSupabasePages();
  return rows.map((page) => ({ ...page, src: getPageImageUrl(page) }));
}

function readLocalPages() {
  return MANIFEST.map((page) => ({
    pageId: page.pageId,
    pageCount: page.pageCount,
    width: page.width,
    height: page.height,
    firstLine: null,
    hasOriginal: false,
    rotation: 0,
    crop: null,
    updatedAt: null,
    isRedacted: false,
  }));
}

async function readSupabasePages() {
  const { getSupabase } = await import("./supabase.js");
  const { data, error } = await getSupabase()
    .from("pages")
    // select("*") rather than a column list, deliberately. Naming columns makes
    // the app hard-fail the moment the code is ahead of the database -- the gap
    // between deploying a change and running its migration -- and the failure is
    // total, because every page calls this. With "*" a not-yet-added column is
    // simply absent and the mapping below falls back to a default.
    .select("*")
    .eq("diary_id", DIARY_ID)
    .order("page_id", { ascending: true });

  if (error) throw new Error(`Could not read pages from Supabase: ${error.message}`);

  return (data ?? []).map((row) => ({
    pageId: row.page_id,
    pageCount: row.page_count,
    width: row.width,
    height: row.height,
    firstLine: row.first_line,
    hasOriginal: Boolean(row.original_key),
    rotation: row.edit_rotation ?? 0,
    crop: row.edit_crop ?? null,
    updatedAt: row.updated_at ?? null,
    isRedacted: Boolean(row.redacted_at),
  }));
}
