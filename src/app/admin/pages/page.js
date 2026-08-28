import { requireAdmin } from "@/lib/auth";
import { getPages } from "@/lib/pages";
import { updateFirstLine } from "../actions";

export const dynamic = "force-dynamic";

export default async function PageIndex() {
  await requireAdmin();
  const pages = await getPages();

  return (
    <>
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
    </>
  );
}
