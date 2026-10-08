"use client";

import Link from "next/link";
import BookViewer from "@/components/BookViewer";

/**
 * The reading view, reused, with an Edit button above each image.
 *
 * The buttons live in BookViewer's toolbar slot rather than inside the page
 * halves. A spread's two halves are two clipped copies of one image, and during
 * a flip those halves are also rendered onto the turning leaf's faces -- putting
 * buttons in there would mean buttons riding the animation.
 */
export default function EditorBrowser({ views, totalPages, diarySlug }) {
  return (
    <BookViewer
      views={views}
      totalPages={totalPages}
      animate={false}
      renderToolbar={(view) => <EditButtons view={view} diarySlug={diarySlug} />}
    />
  );
}

function EditButtons({ view, diarySlug }) {
  // One button per image: a spread is a single image covering two pages, while
  // a paired view is two separate images that crop independently.
  const isSpread = view.pages.length === 1 && view.pages[0].pageCount === 2;

  return (
    <div className={`edittools${isSpread ? " edittools--single" : ""}`}>
      {view.pages.map((page) => {
        const label = isSpread
          ? `Edit spread (pages ${page.pageId}–${page.pageId + 1})`
          : `Edit page ${page.pageId}`;
        return (
          <Link key={page.contentId} className="edittools__btn" href={`/admin/d/${diarySlug}/editor/${page.pageId}`}>
            {label}
            {page.isRedacted && <span className="edittools__flag edittools__flag--redacted">redacted</span>}
            {page.hasOriginal && !page.isRedacted && (
              <span className="edittools__flag">edited</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
