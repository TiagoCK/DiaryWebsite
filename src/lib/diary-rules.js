/**
 * The rules for naming a diary, as pure functions.
 *
 * Separate from src/lib/diaries.js for the same reason ordering.js and views.js
 * are separate from the data layer: that module imports next/navigation, which
 * plain Node cannot resolve, so anything living there cannot be tested without
 * a Next runtime. These rules are exactly the part worth testing.
 */

/** Longest a title, subtitle and slug may be. Slug also bounds the URL. */
export const MAX_TITLE = 120;
export const MAX_SUBTITLE = 200;
export const MAX_SLUG = 60;

/**
 * A title turned into a URL segment.
 *
 * normalize("NFD") over the whole string is correct HERE, unlike in
 * src/lib/search.js where it would be a bug: nothing maps offsets back onto the
 * original afterwards, so the length changing is harmless. "Café 2024" becomes
 * "cafe-2024".
 */
export function slugify(title) {
  return String(title ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG)
    .replace(/^-+|-+$/g, "");
}

/**
 * Validate and normalise what the new-diary form submitted.
 *
 * Pure, so the rules can be tested without a database. The slug pattern matches
 * the CHECK constraint in 0007_diaries.sql exactly -- if these two ever
 * disagree, the form accepts something Postgres then rejects with an error no
 * admin can act on.
 */
export function prepareDiary({ title, slug, subtitle } = {}) {
  const cleanTitle = String(title ?? "").trim();
  if (cleanTitle === "") return { ok: false, message: "A title is required." };
  if (cleanTitle.length > MAX_TITLE) {
    return { ok: false, message: `Title is too long (max ${MAX_TITLE} characters).` };
  }

  const cleanSubtitle = String(subtitle ?? "").trim();
  if (cleanSubtitle.length > MAX_SUBTITLE) {
    return { ok: false, message: `Subtitle is too long (max ${MAX_SUBTITLE} characters).` };
  }

  // An explicit slug wins; otherwise it is derived from the title.
  const given = String(slug ?? "").trim();
  const cleanSlug = given === "" ? slugify(cleanTitle) : slugify(given);

  if (cleanSlug === "") {
    return {
      ok: false,
      message:
        "That title has no letters or numbers to make an address from. " +
        "Type an address yourself, like my-notebook.",
    };
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(cleanSlug)) {
    return { ok: false, message: `"${cleanSlug}" is not a usable address.` };
  }

  return {
    ok: true,
    diary: {
      title: cleanTitle,
      slug: cleanSlug,
      subtitle: cleanSubtitle === "" ? null : cleanSubtitle,
    },
  };
}

/**
 * Who may open a diary.
 *
 *   readers  anyone signed in
 *   admins   admins only
 */
export const VISIBILITIES = ["readers", "admins"];
export const DEFAULT_VISIBILITY = "readers";

/**
 * May this viewer see this diary?
 *
 * One rule, in one place, because it is checked from five different surfaces --
 * the shelf, the reader, search, the admin list and the image route -- and a
 * copy of it that drifted would be a hole rather than an inconsistency.
 *
 * Unknown or missing visibility is treated as `readers`, matching the column
 * default: a diary created before this migration ran must stay readable rather
 * than silently vanishing from everyone's shelf.
 */
export function canSee(diary, viewer) {
  if (!diary) return false;
  if (diary.visibility !== "admins") return true;
  return viewer?.isAdmin === true;
}

/** A visibility value from a form, or the default if it is not one we know. */
export function normaliseVisibility(value) {
  const v = String(value ?? "").trim();
  return VISIBILITIES.includes(v) ? v : DEFAULT_VISIBILITY;
}
