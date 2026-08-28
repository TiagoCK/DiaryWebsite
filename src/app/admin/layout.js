import { requireAdmin } from "@/lib/auth";
import AdminNav from "@/components/AdminNav";

/**
 * Shared chrome for the admin section.
 *
 * The requireAdmin() here is convenience, not the boundary -- every page inside
 * calls it too. getCurrentUser() is memoized with React's cache(), so the
 * duplication costs one lookup per request, not two.
 */
export default async function AdminLayout({ children }) {
  await requireAdmin();

  return (
    <section className="admin">
      <AdminNav />
      {children}
    </section>
  );
}
