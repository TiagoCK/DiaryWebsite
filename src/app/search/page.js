import Link from "next/link";

import HighlightedLine from "@/components/HighlightedLine";
import { requireUser } from "@/lib/auth";
import { getDiaries } from "@/lib/diaries";
import { getPages } from "@/lib/pages";
import { coverage, searchPages } from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * Search every diary by first line, at a URL you can bookmark and send.
 *
 * A plain GET form rather than a client-side filter: this is the version that
 * survives being pasted into a message, and it works with JavaScript off. The
 * viewer has its own live filter for searching the book you are reading; both
 * call searchPages(), so they always agree about what matches.
 *
 * Deliberately across all volumes. Searching one book at a time would mean
 * remembering which one an entry was in, which is the thing you use search to
 * avoid.
 */
export default async function SearchPage({ searchParams }) {
  // Checked here, not just in the proxy -- see src/proxy.js.
  const user = await requireUser("/search");

  const params = await searchParams;
  const raw = params.q;
  const query = (Array.isArray(raw) ? raw[0] : raw ?? "").toString();

  const diaries = await getDiaries(user);
  const perDiary = await Promise.all(
    diaries.map(async (diary) => {
      const pages = await getPages(diary.id);
      return { diary, pages, matches: searchPages(pages, query) };
    })
  );

  const matched = perDiary.filter((entry) => entry.matches.length > 0);
  const total = matched.reduce((n, entry) => n + entry.matches.length, 0);

  const filled = perDiary.reduce((n, e) => n + coverage(e.pages).filled, 0);
  const allPages = perDiary.reduce((n, e) => n + e.pages.length, 0);
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
        {filled} of {allPages} scans have a first line. Only those can be found
        {user.isAdmin ? (
          <>
            ; the rest are typed in from each diary&rsquo;s{" "}
            <Link href="/admin">page index</Link>.
          </>
        ) : (
          "."
        )}
      </p>

      {!searched ? (
        <p className="searchpage__empty">Type something to search for.</p>
      ) : total === 0 ? (
        <p className="searchpage__empty">
          Nothing matches <strong>{query}</strong>.
        </p>
      ) : (
        <>
          <p className="searchpage__count">
            {total} {total === 1 ? "match" : "matches"}
            {matched.length > 1 && ` across ${matched.length} diaries`}
          </p>

          {matched.map(({ diary, matches }) => (
            <section key={diary.id} className="searchpage__group">
              {/* Grouped by volume, and only labelled when there is more than
                  one -- a heading over the single group you already know you
                  are in is noise. */}
              {diaries.length > 1 && (
                <h3 className="searchpage__diary">
                  <Link href={`/d/${diary.slug}`}>{diary.title}</Link>
                </h3>
              )}

              <ul className="searchpage__list">
                {matches.map((page) => {
                  const span =
                    page.pageCount === 1
                      ? `Page ${page.pageId}`
                      : `Pages ${page.pageId}–${page.pageId + page.pageCount - 1}`;
                  return (
                    <li key={page.contentId} className="searchpage__row">
                      {/* Opens that diary, already turned to this page. */}
                      <Link
                        className="searchpage__hit"
                        href={`/d/${diary.slug}?page=${page.pageId}`}
                      >
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
            </section>
          ))}
        </>
      )}
    </section>
  );
}
