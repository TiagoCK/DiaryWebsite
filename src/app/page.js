import BookViewer from "@/components/BookViewer";
import { buildViews, frameAspect, getPages, totalPages } from "@/lib/pages";

export default async function Home() {
  // Metadata only. No image bytes are read here — the browser fetches just the
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
