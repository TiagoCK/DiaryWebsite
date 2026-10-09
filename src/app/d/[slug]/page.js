import BookViewer from "@/components/BookViewer";
import { getViewer, orPaused } from "@/lib/auth";
import { requireDiary } from "@/lib/diaries";
import { getPages } from "@/lib/pages";
import { buildViews, frameAspect, initialViewIndex, totalPages } from "@/lib/views";

/**
 * Rendered per request, never prerendered at build time.
 *
 * The page list lives in Supabase, so prerendering would bake whatever existed
 * at build time into the output, and would make every build depend on the
 * database being reachable. It is also per-user.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  // Gated like the page itself. A browser tab title is a small leak, but a
  // hidden volume's name reaching someone who may not open it is still a leak
  // -- and this runs even when the page below is about to 404.
  const user = await getViewer();
  const { slug } = await params;
  const diary = await orPaused(() => requireDiary(slug, user));
  return { title: `${diary.title} — Bookshelf` };
}

export default async function DiaryPage({ params, searchParams }) {
  // Checked here, not just in the proxy -- see src/proxy.js. getViewer()
  // rather than requireUser(): the viewer may be nobody, and requireDiary()
  // below 404s unless canSee() says this volume is theirs. A `public` volume is
  // readable with no account; everything else still is not.
  const user = await getViewer();

  // A slug from the URL, so it is resolved before it can become a query.
  const { slug } = await params;
  const diary = await orPaused(() => requireDiary(slug, user));

  // Metadata only. No image bytes are read here.
  const pages = await orPaused(() => getPages(diary.id));
  // An empty diary is left to the viewer, which renders a "no pages yet"
  // message with a route back to the uploader. A 404 here would be worse: it
  // would hide a diary the admin is in the middle of filling.
  const views = buildViews(pages);

  // ?page=N opens the diary at that page, which is what a /search result links
  // to. An unknown or malformed number falls back to the beginning rather than
  // erroring -- it arrives from a URL anyone can edit.
  //
  // Only the link is resolved here. The remembered position lives in
  // sessionStorage, which the server cannot see, so the viewer applies that
  // itself on mount -- see initialViewIndex().
  const { page } = await searchParams;
  const linkedPage = Array.isArray(page) ? page[0] : (page ?? null);
  const { index: initialIndex } = initialViewIndex(views, { linkedPage });

  return (
    <div style={{ "--frame-aspect": frameAspect(views) }}>
      <h2 className="diary__title">
        {diary.title}
        {diary.subtitle && <span className="diary__subtitle">{diary.subtitle}</span>}
      </h2>

      {/* Keyed on the deep link: the viewer holds its position in state, so
          without this a second ?page= navigation would leave it where it was. */}
      <BookViewer
        key={initialIndex}
        views={views}
        totalPages={totalPages(pages)}
        initialIndex={initialIndex}
        linkedPage={linkedPage}
        /* Per diary, so reading one book does not move your place in another.
           The admin editor passes nothing and therefore remembers nothing. */
        rememberKey={`diary:${diary.id}`}
      />
    </div>
  );
}
