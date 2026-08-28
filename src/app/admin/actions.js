"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { DIARY_ID } from "@/lib/pages";
import { getSupabase } from "@/lib/supabase";

const MAX_FIRST_LINE = 500;
const ROLES = ["reader", "admin"];

/**
 * Update one page's first_line.
 *
 * requireAdmin() runs HERE, not only on the page that renders the form. A server
 * action is a publicly reachable endpoint with its own generated URL -- guarding
 * the page that shows the form does nothing to guard the action behind it.
 */
export async function updateFirstLine(_prevState, formData) {
  await requireAdmin();

  const pageId = Number(formData.get("pageId"));
  if (!Number.isInteger(pageId) || pageId < 1) {
    return { ok: false, message: "Invalid page." };
  }

  const raw = (formData.get("firstLine") ?? "").toString().trim();
  if (raw.length > MAX_FIRST_LINE) {
    return { ok: false, message: `Too long (max ${MAX_FIRST_LINE} characters).` };
  }

  const { error } = await getSupabase()
    .from("pages")
    .update({ first_line: raw === "" ? null : raw })
    .eq("diary_id", DIARY_ID)
    .eq("page_id", pageId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/pages");
  return { ok: true, message: "Saved." };
}

/**
 * Set another user's role.
 *
 * Upserts rather than updates: nothing creates profile rows automatically (see
 * src/lib/auth.js), so a user who has never signed in has no row yet, and
 * promoting them before their first login has to work.
 */
export async function setUserRole(_prevState, formData) {
  const admin = await requireAdmin();

  const userId = (formData.get("userId") ?? "").toString();
  const role = (formData.get("role") ?? "").toString();

  if (!ROLES.includes(role)) return { ok: false, message: "Unknown role." };

  // Without this an admin can demote themselves, and if they are the only admin
  // nobody can ever assign the role again -- the app has no other way in.
  //
  // This one check is sufficient. Only an admin reaches this action, so the
  // caller is always in the admin list, and demoting anyone else therefore
  // leaves at least the caller. A count of remaining admins would be
  // unreachable code.
  if (userId === admin.id) {
    return { ok: false, message: "You cannot change your own role." };
  }

  const db = getSupabase();
  const { data: user, error: lookupError } = await db.auth.admin.getUserById(userId);
  if (lookupError || !user?.user) return { ok: false, message: "No such user." };

  const { error } = await db
    .from("profiles")
    .upsert({ id: userId, email: user.user.email, role }, { onConflict: "id" });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/people");
  return { ok: true, message: "Saved." };
}
