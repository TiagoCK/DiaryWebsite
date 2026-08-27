import { requireAdmin } from "@/lib/auth";
import { getPages } from "@/lib/pages";
import { getSupabase } from "@/lib/supabase";
import { setUserRole, updateFirstLine } from "./actions";

export const dynamic = "force-dynamic";

/** Auth users joined with whatever profile rows exist. */
async function listPeople() {
  const db = getSupabase();
  const { data: authUsers } = await db.auth.admin.listUsers();
  const { data: profiles } = await db.from("profiles").select("id, role");
  const roleById = new Map((profiles ?? []).map((p) => [p.id, p.role]));

  return (authUsers?.users ?? [])
    .map((u) => ({
      id: u.id,
      email: u.email,
      // No row yet means they have not signed in and nobody has assigned them
      // a role. They will land on 'reader' when they first sign in.
      role: roleById.get(u.id) ?? null,
    }))
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
}

export default async function AdminPage() {
  const admin = await requireAdmin();
  const [pages, people] = await Promise.all([getPages(), listPeople()]);

  return (
    <div className="admin">
      <h2>Page index</h2>
      <p className="admin__note">
        The first line of each scan, used for searching later. A spread covers two
        pages &mdash; use the left-hand page and stay consistent.
      </p>

      <ul className="admin__list">
        {pages.map((page) => {
          const span =
            page.pageCount === 1
              ? `Page ${page.pageId}`
              : `Pages ${page.pageId}\u2013${page.pageId + page.pageCount - 1}`;
          return (
            <li key={page.pageId} className="admin__row">
              <form action={updateFirstLine}>
                <input type="hidden" name="pageId" value={page.pageId} />
                <span className="admin__span">{span}</span>
                <input
                  type="text"
                  name="firstLine"
                  defaultValue={page.firstLine ?? ""}
                  placeholder="First line&hellip;"
                  maxLength={500}
                  aria-label={`First line for ${span}`}
                />
                <button type="submit">Save</button>
              </form>
            </li>
          );
        })}
      </ul>

      <h2 className="admin__heading">People</h2>
      <p className="admin__note">
        Accounts come from Supabase &rarr; Authentication &rarr; Users; they cannot be
        created here. Roles can be set before someone&rsquo;s first sign-in.
      </p>

      <ul className="admin__list">
        {people.map((person) => (
          <li key={person.id} className="admin__row">
            <form action={setUserRole}>
              <input type="hidden" name="userId" value={person.id} />
              <span className="admin__person">
                {person.email}
                {person.role === null && <em className="admin__pending"> never signed in</em>}
              </span>
              {person.id === admin.id ? (
                <span className="admin__self">{person.role} &middot; you</span>
              ) : (
                <>
                  <select name="role" defaultValue={person.role ?? "reader"}>
                    <option value="reader">reader</option>
                    <option value="admin">admin</option>
                  </select>
                  <button type="submit">Set</button>
                </>
              )}
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
