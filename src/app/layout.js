import Link from "next/link";

import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { fontClassName } from "@/lib/fonts";

export const metadata = {
  title: "My Diary",
  description: "A personal diary.",
};

export default async function RootLayout({ children }) {
  // Null on the login page, which is the only unauthenticated surface.
  const user = await getCurrentUser();

  return (
    <html lang="en" className={fontClassName}>
      <body>
        <main>
          {user && (
            <header className="topbar">
              <Link className="topbar__title" href="/">
                My Diary
              </Link>
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
            </header>
          )}
          {children}
        </main>
      </body>
    </html>
  );
}
