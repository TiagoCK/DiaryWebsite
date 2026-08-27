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
