import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { DIARY_SOURCE } from "@/lib/pages";
import { requireDiary } from "@/lib/diaries";
import { getSupabase } from "@/lib/supabase";
import ImageEditor from "@/components/ImageEditor";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }) {
  const admin = await requireAdmin();
  if (DIARY_SOURCE === "local") notFound();

  const { slug, pageId: raw } = await params;
  const diary = await requireDiary(slug, admin);
  if (!/^\d+$/.test(raw)) notFound();
  const pageId = Number(raw);

  const { data: row } = await getSupabase()
    .from("pages")
    // See src/lib/pages.js: "*" keeps this working when the code is ahead of the
    // database, rather than 500ing on a column that does not exist yet.
    .select("*")
    .eq("diary_id", diary.id)
    .eq("page_id", pageId)
    .maybeSingle();

  if (!row) notFound();

  return (
    <ImageEditor
      page={{
        pageId: row.page_id,
        diaryId: diary.id,
        diarySlug: diary.slug,
        pageCount: row.page_count,
        hasOriginal: Boolean(row.original_key),
        rotation: row.edit_rotation ?? 0,
        crop: row.edit_crop ?? null,
        boxes: row.redaction_boxes ?? [],
      }}
    />
  );
}
