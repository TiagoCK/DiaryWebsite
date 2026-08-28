import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { DIARY_ID, DIARY_SOURCE } from "@/lib/pages";
import { getSupabase } from "@/lib/supabase";
import ImageEditor from "@/components/ImageEditor";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }) {
  await requireAdmin();
  if (DIARY_SOURCE === "local") notFound();

  const { pageId: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const pageId = Number(raw);

  const { data: row } = await getSupabase()
    .from("pages")
    // See src/lib/pages.js: "*" keeps this working when the code is ahead of the
    // database, rather than 500ing on a column that does not exist yet.
    .select("*")
    .eq("diary_id", DIARY_ID)
    .eq("page_id", pageId)
    .maybeSingle();

  if (!row) notFound();

  return (
    <ImageEditor
      page={{
        pageId: row.page_id,
        pageCount: row.page_count,
        hasOriginal: Boolean(row.original_key),
        rotation: row.edit_rotation ?? 0,
        crop: row.edit_crop ?? null,
        boxes: row.redaction_boxes ?? [],
      }}
    />
  );
}
