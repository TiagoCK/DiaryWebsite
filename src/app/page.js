import BookViewer from "@/components/BookViewer";
import { requireUser } from "@/lib/auth";
import { getPages } from "@/lib/pages";
import { buildViews, frameAspect, totalPages, viewIndexForPage } from "@/lib/views";

/**
 * Rendered per request, never prerendered at build time.
 *
 * The page list lives in Supabase, so prerendering would bake whatever existed
 * at build time into the output, and would make every build depend on the
 * database being reachable. It is also per-user now.
 */
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }) {
  // Checked here, not just in the middleware -- see src/middleware.js.
  await requireUser();

  // Metadata only. No image bytes are read here.
  const pages = await getPages();
  const views = buildViews(pages);

  // ?page=N opens the diary at that page, which is what a /search result links
  // to. An unknown or malformed number falls back to the beginning rather than
  // erroring -- it arrives from a URL anyone can edit.
  const { page } = await searchParams;
  const requested = Number(Array.isArray(page) ? page[0] : page);
  const found = Number.isInteger(requested) ? viewIndexForPage(views, requested) : -1;
  const initialIndex = found < 0 ? 0 : found;

  return (
    <div style={{ "--frame-aspect": frameAspect(views) }}>
      {/* Keyed on the deep link: the viewer holds its position in state, so
          without this a second /?page= navigation would leave it where it was. */}
      <BookViewer
        key={initialIndex}
        views={views}
        totalPages={totalPages(pages)}
        initialIndex={initialIndex}
      />
    </div>
  );
}
