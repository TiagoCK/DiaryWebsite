import { readFile } from "node:fs/promises";
import path from "node:path";
import { ALLOWED_FILES } from "@/lib/pages";

const SCANS_DIR = path.join(process.cwd(), "images");

/**
 * Serves a diary scan from the local images/ folder.
 *
 * The scans stay out of git and out of public/, so they need a route to reach
 * the browser. The requested name is checked against the manifest allowlist
 * rather than sanitized: joining caller-supplied input onto a filesystem path
 * is a directory-traversal hole, and an allowlist closes it by construction.
 *
 * Replaced in the next round by signed Supabase Storage URLs.
 */
export async function GET(request, { params }) {
  const { file } = await params;

  if (!ALLOWED_FILES.has(file)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const bytes = await readFile(path.join(SCANS_DIR, file));
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        // Private content: cacheable by the browser, never by a shared cache.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
