import { requireAdmin } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import ActionForm from "@/components/ActionForm";
import { setUserRole } from "../actions";

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

export default async function People() {
  const admin = await requireAdmin();
  const people = await listPeople();

  return (
    <>
      <h2>People</h2>
      <p className="admin__note">
        Accounts come from Supabase &rarr; Authentication &rarr; Users; they cannot be
        created here. Roles can be set before someone&rsquo;s first sign-in.
      </p>

      <ul className="admin__list">
        {people.map((person) => (
          <li key={person.id} className="admin__row">
            <ActionForm action={setUserRole}>
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
            </ActionForm>
          </li>
        ))}
      </ul>
    </>
  );
}
