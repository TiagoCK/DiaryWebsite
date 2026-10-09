import { getCurrentUser } from "@/lib/auth";
import { BUCKET, getSupabase } from "@/lib/supabase";

/**
 * Serves a scan's pristine original to the image editor.
 *
 * This is the ONLY route that can reach the originals/ prefix -- /api/scan has
 * no code path to it at all. Admin-gated here rather than relying on the
 * proxy, for the same reason as everywhere else in this app.
 *
 * It matters more once censor bars exist: originals will hold uncensored
 * content until a redaction re-baselines them, so this endpoint is the boundary
 * keeping that away from non-admins.
 */
export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!user.isAdmin) return new Response("Forbidden", { status: 403 });

  const { diaryId: rawDiary, pageId: raw } = await params;
  if (!/^\d+$/.test(raw) || !/^\d+$/.test(rawDiary)) {
    return new Response("Not found", { status: 404 });
  }

  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from("pages")
    .select("storage_key, original_key")
    .eq("diary_id", Number(rawDiary))
    .eq("page_id", Number(raw))
    .maybeSingle();

  if (error) return new Response("Upstream error", { status: 502 });
  if (!row) return new Response("Not found", { status: 404 });

  // Before any edit there is no separate original -- the live object still is one.
  const key = row.original_key ?? row.storage_key;

  // Streamed, not redirected to a signed URL, for two reasons. The editor draws
  // this image to a canvas to preview rotation, and a cross-origin image taints
  // the canvas so toDataURL() throws -- serving it from our own origin avoids
  // that entirely. It also means no URL for the original ever reaches the
  // browser, which matters more once originals hold pre-redaction content.
  const { data: blob, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(key);

  if (downloadError || !blob) return new Response("Upstream error", { status: 502 });

  const bytes = Buffer.from(await blob.arrayBuffer());
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

export const dynamic = "force-dynamic";
