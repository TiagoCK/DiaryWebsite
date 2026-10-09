/**
 * The shelf: which books exist.
 *
 * `diary_id` has been on every page row since the first migration, but until
 * now it pointed at nothing -- a number that was always 1. This is the table it
 * refers to, and the seam that turns "the diary" into "a diary".
 *
 * Server-only, like src/lib/pages.js. Read through the service-role client;
 * the diaries table is RLS-closed for the same reason pages is.
 */

import { notFound } from "next/navigation";

import { canSee, DEFAULT_VISIBILITY } from "./diary-rules.js";
import { outageOr } from "./outage.js";
import { DEFAULT_DIARY_ID, DIARY_SOURCE } from "./pages.js";

/**
 * The single diary that local mode serves.
 *
 * DIARY_SOURCE=local reads a manifest off disk and has no database at all, so
 * there is nothing to list. It keeps working as a one-book view rather than
 * gaining a broken shelf.
 */
const LOCAL_DIARY = {
  id: DEFAULT_DIARY_ID,
  slug: "first-notebook",
  title: "First Notebook",
  subtitle: null,
  position: 1,
  visibility: DEFAULT_VISIBILITY,
};

/**
 * Every diary this viewer may open, in shelf order.
 *
 * The viewer is required, not optional. A default would mean a call site that
 * forgot to pass one silently listed the hidden volumes -- the same reasoning
 * as getPages(diaryId), and the same reason it throws rather than guessing.
 */
export async function getDiaries(viewer) {
  if (viewer === undefined) {
    throw new Error("getDiaries needs a viewer; pass the current user.");
  }
  if (DIARY_SOURCE === "local") return [LOCAL_DIARY];

  const { getSupabase } = await import("./supabase.js");
  // `status` as well as `error`: see readSupabasePages() in ./pages.js.
  const { data, error, status } = await getSupabase()
    .from("diaries")
    // select("*") for the same reason as pages: a column added in code before
    // its migration has run should degrade, not take the whole site down.
    .select("*")
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw outageOr(error, `Could not read diaries: ${error.message}`, status);
  return (data ?? []).map(toDiary).filter((diary) => canSee(diary, viewer));
}

/** One diary by its slug, or null if it does not exist or is not for this viewer. */
export async function getDiaryBySlug(slug, viewer) {
  if (viewer === undefined) {
    throw new Error("getDiaryBySlug needs a viewer; pass the current user.");
  }
  if (typeof slug !== "string" || slug === "") return null;
  if (DIARY_SOURCE === "local") return slug === LOCAL_DIARY.slug ? LOCAL_DIARY : null;

  const { getSupabase } = await import("./supabase.js");
  const { data, error, status } = await getSupabase()
    .from("diaries")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw outageOr(error, `Could not read diary ${slug}: ${error.message}`, status);
  if (!data) return null;
  const diary = toDiary(data);
  return canSee(diary, viewer) ? diary : null;
}

/**
 * One diary by slug, or a 404.
 *
 * Every page and action that names a diary in its URL goes through this, so a
 * slug someone typed cannot become a query against a diary that does not exist.
 */
export async function requireDiary(slug, viewer) {
  const diary = await getDiaryBySlug(slug, viewer);
  // 404, not 403. A diary the viewer may not open should not confirm that it
  // exists -- "forbidden" tells you there is something there to find.
  if (!diary) notFound();
  return diary;
}

function toDiary(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle ?? null,
    position: row.position ?? row.id,
    // Absent on a database that has not run the diary-visibility migration
    // yet; default to readable so
    // schema drift does not empty everyone's shelf.
    visibility: row.visibility ?? DEFAULT_VISIBILITY,
  };
}
