/**
 * The rules for reordering pages, with no database and no React in sight so
 * they can be exercised directly.
 *
 * The diary is an ordered list of scans; page numbers are derived from that
 * order by cumulative page_count, not stored independently. That matters
 * because the numbering is dense: a two-page spread occupies N and N+1, so
 * "swap these two page numbers" is only meaningful when both scans are the same
 * size. Treating order as the truth and numbers as derived makes a
 * single-versus-spread swap well defined instead of leaving a gap and a
 * collision.
 *
 * Every function here takes `pages` as `{ pageId, pageCount, storageKey }`
 * objects. Scans are identified by storageKey rather than pageId, because
 * pageId is the thing being rewritten.
 */

/** Each scan with the span of page numbers it occupies, in reading order. */
export function buildOrder(pages) {
  return [...pages]
    .sort((a, b) => a.pageId - b.pageId)
    .map((page) => ({
      ...page,
      start: page.pageId,
      end: page.pageId + page.pageCount - 1,
    }));
}

/** The highest page number in the diary. */
export function lastPageNumber(pages) {
  const order = buildOrder(pages);
  return order.length ? order[order.length - 1].end : 0;
}

/**
 * What a requested page number actually refers to.
 *
 *   start        the first page of a scan -- the only thing that can be swapped
 *   interior     inside a scan but not its first page, i.e. the second half of
 *                a spread. Half of this diary's numbers are these.
 *   out-of-range beyond the diary, or below 1
 */
export function classifyTarget(pages, target) {
  if (!Number.isInteger(target)) return { kind: "invalid" };

  const order = buildOrder(pages);
  const max = order.length ? order[order.length - 1].end : 0;
  if (target < 1 || target > max) return { kind: "out-of-range", max };

  const owner = order.find((page) => target >= page.start && target <= page.end);
  if (!owner) return { kind: "out-of-range", max };

  return { kind: owner.start === target ? "start" : "interior", owner };
}

/**
 * The new order after swapping the scan at `movingPageId` with the one starting
 * at `targetPageId`. Returns storage keys in reading order, or null if either
 * page number is not a scan start.
 */
export function reorderedKeys(pages, movingPageId, targetPageId) {
  const order = buildOrder(pages);
  const from = order.findIndex((page) => page.pageId === movingPageId);
  const to = order.findIndex((page) => page.pageId === targetPageId);
  if (from < 0 || to < 0) return null;

  const swapped = [...order];
  [swapped[from], swapped[to]] = [swapped[to], swapped[from]];
  return swapped.map((page) => page.storageKey);
}

/**
 * The page numbers an ordering would produce, without applying it.
 *
 * Used to tell the admin where a scan actually landed: when the two scans are
 * different sizes the moved one ends up one off the number they typed, and
 * saying so is better than quietly doing something else.
 */
export function projectSpans(pages, keys) {
  const byKey = new Map(pages.map((page) => [page.storageKey, page]));
  let next = 1;

  return keys.map((storageKey) => {
    const page = byKey.get(storageKey);
    const pageCount = page?.pageCount ?? 1;
    const span = { storageKey, pageId: next, pageCount, start: next, end: next + pageCount - 1 };
    next += pageCount;
    return span;
  });
}

/** "page 4" or "pages 3–4", for messages. */
export function describeSpan({ start, end }) {
  return start === end ? `page ${start}` : `pages ${start}–${end}`;
}
