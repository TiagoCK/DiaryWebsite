import BookViewer from "@/components/BookViewer";
import { requireUser } from "@/lib/auth";
import { getPages } from "@/lib/pages";
import { buildViews, frameAspect, totalPages } from "@/lib/views";

/**
 * Rendered per request, never prerendered at build time.
 *
 * The page list lives in Supabase, so prerendering would bake whatever existed
 * at build time into the output, and would make every build depend on the
 * database being reachable. It is also per-user now.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  // Checked here, not just in the middleware -- see src/middleware.js.
  await requireUser();

  // Metadata only. No image bytes are read here.
  const pages = await getPages();
  const views = buildViews(pages);

  return (
    <div style={{ "--frame-aspect": frameAspect(views) }}>
      <BookViewer views={views} totalPages={totalPages(pages)} />
    </div>
  );
}
