import "./globals.css";
import { getCurrentUser } from "@/lib/auth";

export const metadata = {
  title: "My Diary",
  description: "A personal diary.",
};

export default async function RootLayout({ children }) {
  // Null on the login page, which is the only unauthenticated surface.
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body>
        <main>
          {user && (
            <header className="topbar">
              <a className="topbar__title" href="/">
                My Diary
              </a>
              <div className="topbar__right">
                <span className="topbar__user">
                  {user.email}
                  <span className={`badge badge--${user.role}`}>{user.role}</span>
                </span>
                {user.isAdmin && (
                  <a className="topbar__link" href="/admin">
                    Admin
                  </a>
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
