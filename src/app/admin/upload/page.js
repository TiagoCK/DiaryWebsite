import UploadForm from "@/components/UploadForm";
import { requireAdmin } from "@/lib/auth";
import { getPages } from "@/lib/pages";
import { totalPages } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  await requireAdmin();

  // Only to show where the new pages would land. The commit route works this
  // out again for itself against the database at the moment it writes.
  const pages = await getPages();

  return (
    <>
      <h2>Upload</h2>
      <p className="admin__note">
        Adds scans to the <strong>end</strong> of the diary, the same as{" "}
        <code>npm run add</code>. A PDF becomes one diary page per PDF page, in
        order. Pages are stored as JPEG at up to 1600px wide; the file you pick is
        also kept in <code>images/</code> as the full-resolution master.
      </p>

      <UploadForm lastPage={totalPages(pages)} />
    </>
  );
}
