import Link from "next/link";

import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { fontClassName } from "@/lib/fonts";

export const metadata = {
  title: "Bookshelf",
  description: "A shelf of scanned volumes, read as books.",
};

export default async function RootLayout({ children }) {
  // Null for a signed-out visitor, which is no longer only the login page: a
  // volume marked `public` is readable with no account at all.
  //
  // getCurrentUser() rather than getViewer(): a layout must not redirect. It
  // wraps /paused too, so a redirect here during an outage would fight the one
  // the pages already do, and null is the right answer for deciding what
  // chrome to draw.
  const user = await getCurrentUser();

  return (
    <html lang="en" className={fontClassName}>
      <body>
        <main>
          {/*
            The header is unconditional now. It used to render only for a
            signed-in user, which left an anonymous visitor on a public volume
            with no way home and no way to sign in -- a dead end reachable by
            anyone with the link.
          */}
          <header className="topbar">
            <Link className="topbar__title" href="/">
              Bookshelf
            </Link>
            {user ? (
              <div className="topbar__right">
                <span className="topbar__user">
                  {user.email}
                  <span className={`badge badge--${user.role}`}>{user.role}</span>
                </span>
                <Link className="topbar__link" href="/search">
                  Search
                </Link>
                {user.isAdmin && (
                  <>
                    <Link className="topbar__link" href="/admin">
                      Admin
                    </Link>
                  </>
                )}
                <form action="/auth/signout" method="post">
                  <button type="submit" className="topbar__signout">
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <div className="topbar__right">
                <Link className="topbar__link" href="/login">
                  Sign in
                </Link>
              </div>
            )}
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}
