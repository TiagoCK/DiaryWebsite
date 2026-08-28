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
    .select("page_id, page_count, width, height, original_key, edit_rotation, edit_crop")
    .eq("diary_id", DIARY_ID)
    .eq("page_id", pageId)
    .maybeSingle();

  if (!row) notFound();

  return (
    <ImageEditor
      page={{
        pageId: row.page_id,
        pageCount: row.page_count,
        width: row.width,
        height: row.height,
        hasOriginal: Boolean(row.original_key),
        rotation: row.edit_rotation ?? 0,
        crop: row.edit_crop ?? null,
      }}
    />
  );
}
