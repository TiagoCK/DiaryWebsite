/**
 * Data access for diary pages.
 *
 * This module is the seam between the viewer and wherever the scans live.
 * Today that is a hardcoded manifest plus files on disk; next it will be a
 * Supabase `pages` table plus signed Storage URLs. Only the bodies of
 * getPages() and getPageImageUrl() change — the viewer never learns the
 * difference.
 */

const SCAN_PREFIX = "1787802885506-91ca7dc4-4c02-4bfc-8f87-fb08cb631c08_";

/**
 * Ordered scans. Mirrors the future `pages` table one field at a time:
 *   pageId    -> page_id     first physical page number in this scan
 *   pageCount -> page_count  1 for a single page, 2 for an open spread
 *   width/height             DISPLAY dimensions, already EXIF-corrected
 *
 * Every scan here carries an EXIF orientation of 6 or 8, so its stored JPEG
 * dimensions are portrait and its displayed dimensions are landscape. The
 * numbers below are the displayed ones. Browsers rotate automatically; any
 * server-side image processing must call sharp().rotate() or three of these
 * spreads come out upside-down relative to the rest.
 *
 * Order is explicit rather than derived from filenames: both batches end in
 * digits, so sorting on the trailing number alone interleaves them.
 */
const MANIFEST = [
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

/** Filenames the scan route is allowed to serve. */
export const ALLOWED_FILES = new Set(MANIFEST.map((p) => p.file));

/** Ordered page records. Metadata only — no image bytes. */
export async function getPages() {
  return MANIFEST.map((p) => ({ ...p, src: getPageImageUrl(p) }));
}

/**
 * URL for a page's image. Becomes a signed Supabase Storage URL later, which
 * is why callers must treat it as opaque and short-lived rather than caching it.
 */
export function getPageImageUrl(page) {
  return `/api/scan/${encodeURIComponent(page.file)}`;
}

/**
 * Group ordered pages into views — one frame of the open book.
 *
 * A spread fills a view alone. Two consecutive single pages pair into one
 * view, left and right. A trailing unpaired single sits on the left with a
 * blank facing page.
 */
export function buildViews(pages) {
  const views = [];
  let pending = null;

  const push = (items) => {
    const first = items[0].pageId;
    const last = items[items.length - 1];
    const lastNum = last.pageId + last.pageCount - 1;
    views.push({
      index: views.length,
      pages: items,
      label: first === lastNum ? `Page ${first}` : `Pages ${first}\u2013${lastNum}`,
    });
  };

  for (const page of pages) {
    if (page.pageCount === 1) {
      if (pending) {
        push([pending, page]);
        pending = null;
      } else {
        pending = page;
      }
      continue;
    }
    if (pending) {
      push([pending]);
      pending = null;
    }
    push([page]);
  }
  if (pending) push([pending]);

  return views;
}

/**
 * One half of a view, described so the viewer can render it identically
 * whether it comes from half a spread or a whole single page.
 * Returns null for a blank facing page.
 */
export function halfOf(view, side) {
  if (!view) return null;
  const { pages } = view;

  if (pages.length === 2) {
    const page = side === "left" ? pages[0] : pages[1];
    return { page, clip: null };
  }

  const page = pages[0];
  if (page.pageCount === 1) {
    return side === "left" ? { page, clip: null } : null;
  }
  return { page, clip: side };
}

/**
 * Width-to-height ratio for the fixed book frame: the widest view, so every
 * scan letterboxes inside one frame that never changes size between flips.
 */
export function frameAspect(views) {
  let max = 1;
  for (const view of views) {
    const ratio = view.pages.reduce((sum, p) => sum + p.width / p.height, 0);
    if (ratio > max) max = ratio;
  }
  return max;
}

/** Highest page number in the diary, for the "of N" counter. */
export function totalPages(pages) {
  if (pages.length === 0) return 0;
  const last = pages[pages.length - 1];
  return last.pageId + last.pageCount - 1;
}
