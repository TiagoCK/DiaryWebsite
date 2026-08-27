import { readFile } from "node:fs/promises";
import path from "node:path";
import { DIARY_ID, DIARY_SOURCE, findLocalPage } from "@/lib/pages";
import { getCurrentUser } from "@/lib/auth";

const SCANS_DIR = path.join(process.cwd(), "images");

/**
 * Serves the image for one diary page.
 *
 * This route is the indirection layer that keeps the rest of the app unaware of
 * where images live. It is keyed by page number, never by filename or storage
 * key, so nothing about the storage layout reaches the browser.
 *
 *   local     page number -> manifest -> file on disk, streamed
 *   supabase  page number -> row -> signed Storage URL, redirected to
 *
 * Either way the caller just requests /api/scan/<pageId>.
 *
 * This route serves the actual diary images, which makes it the most important
 * thing to protect. It checks the session itself rather than trusting the
 * middleware: if the middleware were ever bypassed, this is the endpoint that
 * would hand over the whole diary.
 */
export async function GET(request, { params }) {
  // 401 rather than a redirect -- the caller is an <img>, not a browser
  // navigation, and a redirect to an HTML login page would just decode as a
  // broken image.
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { pageId: raw } = await params;

  // Reject anything that is not a plain positive integer before it can reach a
  // filesystem path or a query.
  if (!/^\d+$/.test(raw)) return notFound();
  const pageId = Number(raw);

  return DIARY_SOURCE === "local" ? serveFromDisk(pageId) : serveFromSupabase(pageId);
}

async function serveFromDisk(pageId) {
  // The manifest is the allowlist: a page number that is not in it never
  // reaches readFile, so no caller-supplied string is joined onto a path.
  const page = findLocalPage(pageId);
  if (!page) return notFound();

  try {
    const bytes = await readFile(path.join(SCANS_DIR, page.file));
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return notFound();
  }
}

async function serveFromSupabase(pageId) {
  const { getSupabase, BUCKET, SIGNED_URL_TTL_SECONDS } = await import("@/lib/supabase");
  const supabase = getSupabase();

  const { data: row, error } = await supabase
    .from("pages")
    .select("storage_key")
    .eq("diary_id", DIARY_ID)
    .eq("page_id", pageId)
    .maybeSingle();

  if (error) {
    console.error(`scan route: page ${pageId} lookup failed:`, error.message);
    return new Response("Upstream error", { status: 502 });
  }
  if (!row) return notFound();

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_key, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    console.error(`scan route: signing ${row.storage_key} failed:`, signError?.message);
    return new Response("Upstream error", { status: 502 });
  }

  // no-store is required, not just polite: a cached redirect would outlive the
  // signed URL it points at and start handing out links that 400.
  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, "Cache-Control": "no-store" },
  });
}

function notFound() {
  return new Response("Not found", { status: 404 });
}

export const dynamic = "force-dynamic";
