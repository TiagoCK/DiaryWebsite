import BookViewer from "@/components/BookViewer";
import { getPages } from "@/lib/pages";
import { buildViews, frameAspect, totalPages } from "@/lib/views";

/**
 * Rendered per request, never prerendered at build time.
 *
 * The page list lives in Supabase, so prerendering would bake whatever existed
 * at build time into the output -- newly uploaded scans would not appear until
 * the next deploy -- and would make every build depend on the database being
 * reachable, which a paused free-tier project is not.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  // Metadata only. No image bytes are read here -- the browser fetches just the
  // current view and its neighbours.
  const pages = await getPages();
  const views = buildViews(pages);

  return (
    <main style={{ "--frame-aspect": frameAspect(views) }}>
      <h1>My Diary</h1>
      <BookViewer views={views} totalPages={totalPages(pages)} />
    </main>
  );
}
