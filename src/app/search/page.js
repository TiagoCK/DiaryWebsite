import Link from "next/link";

import HighlightedLine from "@/components/HighlightedLine";
import { requireUser } from "@/lib/auth";
import { getPages } from "@/lib/pages";
import { coverage, searchPages } from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * Search the diary by first line, at a URL you can bookmark and send.
 *
 * A plain GET form rather than a client-side filter: this is the version that
 * survives being pasted into a message, and it works with JavaScript off. The
 * viewer has its own live filter for searching while you read; both call
 * searchPages(), so they always agree about what matches.
 */
export default async function SearchPage({ searchParams }) {
  // Checked here, not just in the middleware -- see src/middleware.js.
  const user = await requireUser("/search");

  const params = await searchParams;
  const raw = params.q;
  const query = (Array.isArray(raw) ? raw[0] : raw ?? "").toString();

  const pages = await getPages();
  const matches = searchPages(pages, query);
  const { filled, total } = coverage(pages);
  const searched = query.trim() !== "";

  return (
    <section className="searchpage">
      <h2>Search</h2>

      <form className="searchpage__form" method="get" action="/search">
        <label className="searchpage__label" htmlFor="q">
          First line contains
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="a word from the first line&hellip;"
          autoComplete="off"
        />
        <button type="submit">Search</button>
      </form>

      <p className="admin__note">
        {filled} of {total} scans have a first line. Only those can be found
        {/* The page index is admin-only, so readers are not sent to a door
            that will bounce them straight back here. */}
        {user.isAdmin ? (
          <>
            ; the rest are typed in from the{" "}
            <Link href="/admin/pages">page index</Link>.
          </>
        ) : (
          "."
        )}
      </p>

      {!searched ? (
        <p className="searchpage__empty">Type something to search for.</p>
      ) : matches.length === 0 ? (
        <p className="searchpage__empty">
          Nothing matches <strong>{query}</strong>.
        </p>
      ) : (
        <>
          <p className="searchpage__count">
            {matches.length} {matches.length === 1 ? "match" : "matches"}
          </p>
          <ul className="searchpage__list">
            {matches.map((page) => {
              const span =
                page.pageCount === 1
                  ? `Page ${page.pageId}`
                  : `Pages ${page.pageId}–${page.pageId + page.pageCount - 1}`;
              return (
                <li key={page.contentId} className="searchpage__row">
                  {/* Opens the reader already turned to this page. */}
                  <Link className="searchpage__hit" href={`/?page=${page.pageId}`}>
                    <img
                      className="order__thumb"
                      src={page.src}
                      alt=""
                      width={page.width}
                      height={page.height}
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="searchpage__meta">
                      <span className="order__span">{span}</span>
                      <HighlightedLine text={page.firstLine} query={query} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
