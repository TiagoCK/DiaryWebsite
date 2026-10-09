/**
 * Pure view-model helpers: turning an ordered list of pages into book frames.
 *
 * Deliberately free of any data-source import. The viewer is a client component
 * and needs halfOf(), so anything it imports ends up in the browser bundle --
 * keeping these functions here is what stops src/lib/pages.js, and through it
 * the Supabase client, from being pulled into client code at all.
 */

/**
 * Group ordered pages into views -- one frame of the open book.
 *
 * A spread fills a view alone. Two consecutive single pages pair into one view,
 * left and right. A trailing unpaired single sits on the left with a blank
 * facing page.
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
 * One half of a view, described so the viewer can render it identically whether
 * it comes from half a spread or a whole single page.
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
 * The page number a half shows.
 *
 * One rule covers every case, because `clip` is set only for a spread: a
 * clipped right half is the second of the two numbers that scan spans, and
 * anything else -- a whole single page, or either side of a paired view -- is
 * its own scan's first number. A paired view works out because its two halves
 * are two different scans, each carrying its own pageId.
 */
export function pageNumberOfHalf(half) {
  if (!half) return null;
  return half.clip === "right" ? half.page.pageId + 1 : half.page.pageId;
}

/**
 * Every physical page in reading order, as halves.
 *
 * The unit the scrolling mode scrolls: one item per page, rather than one per
 * frame. Deliberately the same { page, clip } shape halfOf() returns, with a
 * number added, so one <Half> component renders a scroll item and a book slot
 * alike -- the clipping CSS lays the image out against its own container, so
 * the book frame was never special.
 *
 * A spread becomes two items, a single page becomes one, and the blank facing
 * page of a trailing single becomes none: there is nothing there to scroll to.
 *
 * It asks halfOf() rather than reading the pages itself, which means it
 * inherits that function's limits instead of improving on them. A scan claiming
 * more than two pages already renders as two halves in the book, and so does it
 * here -- two modes that are imperfect in the same way are easier to reason
 * about than two that disagree.
 */
export function buildHalves(views) {
  const halves = [];
  for (const view of views) {
    for (const side of ["left", "right"]) {
      const half = halfOf(view, side);
      if (half) halves.push({ ...half, pageNumber: pageNumberOfHalf(half) });
    }
  }
  return halves;
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

/**
 * The index of the view containing a page number, or -1 if no view holds it.
 *
 * Interior numbers resolve to their frame rather than being refused: asking for
 * page 4 shows the spread at pages 3-4. That is deliberately the opposite of
 * src/lib/ordering.js, which rejects an interior number -- reordering has to
 * know which *scan* you mean, while reading only has to know which *frame*.
 */
/**
 * Which frame to open on, and why.
 *
 * Three sources, in strict order of authority:
 *
 *   link        ?page=N in the URL -- somebody followed a link and meant it,
 *               so it beats whatever the reader was last looking at.
 *   remembered  where this reading session left off.
 *   default     the beginning.
 *
 * Both inputs are coerced and range-checked, because both arrive from places a
 * person can edit: one from the address bar, the other from browser storage.
 * A page number that no longer exists -- the diary shrank, or a page was
 * removed -- falls through to the next source rather than opening a blank frame.
 *
 * Returning the source, not just the index, is what lets the viewer avoid
 * re-persisting a position it just restored, and lets the tests say which rule
 * fired rather than only where it landed.
 */
export function initialViewIndex(views, { linkedPage, rememberedPage } = {}) {
  const linked = viewIndexForPage(views, Number(linkedPage));
  if (linked >= 0) return { index: linked, source: "link" };

  const remembered = viewIndexForPage(views, Number(rememberedPage));
  if (remembered >= 0) return { index: remembered, source: "remembered" };

  return { index: 0, source: "default" };
}

export function viewIndexForPage(views, pageNumber) {
  if (!Number.isInteger(pageNumber)) return -1;

  for (const view of views) {
    const first = view.pages[0].pageId;
    const last = view.pages[view.pages.length - 1];
    if (pageNumber >= first && pageNumber <= last.pageId + last.pageCount - 1) {
      return view.index;
    }
  }
  return -1;
}
