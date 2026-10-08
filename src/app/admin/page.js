import Link from "next/link";

import ActionForm from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth";
import { createDiary, deleteDiary, setDiaryVisibility } from "@/app/admin/actions";
import { getDiaries } from "@/lib/diaries";
import { getPages } from "@/lib/pages";
import { coverage } from "@/lib/search";
import { totalPages } from "@/lib/views";

export const dynamic = "force-dynamic";

/**
 * The admin shelf.
 *
 * Everything except People belongs to a particular diary, so this is where you
 * say which one. It used to redirect straight to the page index, which only
 * made sense while there was exactly one book to edit.
 */
export default async function AdminIndex() {
  const admin = await requireAdmin();

  const diaries = await getDiaries(admin);
  const shelf = await Promise.all(
    diaries.map(async (diary) => {
      const pages = await getPages(diary.id);
      return { diary, pages: totalPages(pages), rows: pages.length, ...coverage(pages) };
    })
  );

  return (
    <>
      <h2>Diaries</h2>
      <p className="admin__note">
        Page index, order, upload and the image editor all belong to one diary.
        Choose which.
      </p>

      {shelf.length === 0 && (
        <p className="admin__note">
          No diaries yet. Create the first one below.
        </p>
      )}

      <ul className="adminshelf">
        {shelf.map(({ diary, pages, rows, filled, total }) => (
          <li key={diary.id} className="adminshelf__item">
            <div className="adminshelf__head">
              <Link className="adminshelf__title" href={`/d/${diary.slug}`}>
                {diary.title}
              </Link>
              <span className="adminshelf__meta">
                {pages === 0 ? "no pages" : `${pages} pages`}
                {total > 0 && ` · ${filled}/${total} scans have a first line`}
                <code className="adminshelf__slug">/d/{diary.slug}</code>
                {diary.visibility === "admins" && (
                  <span className="badge badge--admin">admins only</span>
                )}
              </span>
            </div>

            <nav className="adminshelf__links">
              <Link href={`/admin/d/${diary.slug}/pages`}>Page index</Link>
              <Link href={`/admin/d/${diary.slug}/upload`}>Upload</Link>
              <Link href={`/admin/d/${diary.slug}/editor`}>Image editor</Link>
              <Link href={`/admin/d/${diary.slug}/order`}>Order</Link>

              {/* Only offered while the diary is empty. Deleting one with pages
                  would strand their storage objects, which SQL cannot reach --
                  the foreign key refuses it too, but not offering the button is
                  a better answer than explaining a constraint violation. */}
              {/* One button, not a dropdown: with two values a toggle that
                  states what it will do is clearer than a select plus Save. */}
              <ActionForm action={setDiaryVisibility} className="adminshelf__visibility">
                <input type="hidden" name="diaryId" value={diary.id} />
                <input
                  type="hidden"
                  name="visibility"
                  value={diary.visibility === "admins" ? "readers" : "admins"}
                />
                <button type="submit">
                  {diary.visibility === "admins" ? "Make visible to readers" : "Make admins only"}
                </button>
              </ActionForm>

              {rows === 0 && (
                <ActionForm action={deleteDiary} className="adminshelf__remove">
                  <input type="hidden" name="diaryId" value={diary.id} />
                  <button type="submit">Remove</button>
                </ActionForm>
              )}
            </nav>
          </li>
        ))}
      </ul>

      <section className="newdiary">
        <h3>New diary</h3>
        <p className="admin__note">
          The address is derived from the title unless you set one. It becomes
          the URL, so it is worth keeping short.
        </p>

        <ActionForm action={createDiary} className="newdiary__form">
          <label htmlFor="new-title">Title</label>
          <input
            id="new-title"
            name="title"
            type="text"
            required
            maxLength={120}
            placeholder="Second Notebook"
          />

          <label htmlFor="new-subtitle">Subtitle (optional)</label>
          <input
            id="new-subtitle"
            name="subtitle"
            type="text"
            maxLength={200}
            placeholder="1998–2001"
          />

          <label htmlFor="new-slug">Address (optional)</label>
          <input
            id="new-slug"
            name="slug"
            type="text"
            maxLength={60}
            placeholder="second-notebook"
            /* Not pattern-validated in the browser: prepareDiary() tidies
               "My Trip!" into "my-trip" rather than rejecting it, and a native
               validation bubble would block the submit before it could. */
            autoComplete="off"
          />

          <span className="newdiary__label">Visible to</span>
          <span className="newdiary__radios">
            <label>
              <input type="radio" name="visibility" value="readers" defaultChecked />
              Everyone signed in
            </label>
            <label>
              <input type="radio" name="visibility" value="admins" />
              Admins only
            </label>
          </span>

          <button type="submit">Create diary</button>
        </ActionForm>
      </section>
    </>
  );
}
