import ActionForm from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth";
import { DIARY_SOURCE, getPages } from "@/lib/pages";
import { buildOrder, describeSpan, lastPageNumber } from "@/lib/ordering";
import { movePage } from "./actions";

export const dynamic = "force-dynamic";

export default async function OrderPage() {
  await requireAdmin();

  if (DIARY_SOURCE === "local") {
    return (
      <>
        <h2>Order</h2>
        <p className="admin__note">
          Unavailable while <code>DIARY_SOURCE=local</code>. Reordering rewrites page
          numbers in the database. Set <code>DIARY_SOURCE=supabase</code> in{" "}
          <code>.env.local</code> to use it.
        </p>
      </>
    );
  }

  const pages = await getPages();
  // getPages() omits storage keys, so none reach the browser; buildOrder only
  // needs page numbers and counts to compute spans.
  const order = buildOrder(pages);
  const last = lastPageNumber(pages);

  return (
    <>
      <h2>Order</h2>
      <p className="admin__note">
        Set a scan to a page number and it swaps with whatever starts there. Page
        numbers run 1&ndash;{last}. A spread covers two of them, so only the first
        number of a scan can be targeted &mdash; aiming at the second half will say
        which scan owns it.
      </p>

      <ul className="order__list">
        {order.map((page) => (
          <li key={page.contentId} className="order__row">
            {/* Reordering scans you cannot see is guesswork, so each row shows
                its image. Lazy, since this is a list of every page. */}
            <img
              className="order__thumb"
              src={page.src}
              alt=""
              width={page.width}
              height={page.height}
              loading="lazy"
              decoding="async"
            />

            <div className="order__meta">
              <span className="order__span">{describeSpan(page)}</span>
              {page.firstLine && <span className="order__line">{page.firstLine}</span>}
              {page.isRedacted && <span className="edittools__flag edittools__flag--redacted">redacted</span>}
            </div>

            <ActionForm action={movePage} className="order__form">
              <input type="hidden" name="pageId" value={page.pageId} />
              <label htmlFor={`target-${page.pageId}`}>Move to page</label>
              <input
                id={`target-${page.pageId}`}
                type="number"
                name="target"
                min="1"
                max={last}
                inputMode="numeric"
                placeholder={String(page.start)}
              />
              <button type="submit">Move</button>
            </ActionForm>
          </li>
        ))}
      </ul>
    </>
  );
}
