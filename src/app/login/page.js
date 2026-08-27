"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

/**
 * Sign-in form.
 *
 * There is deliberately no sign-up here, no "create account" link, and no call
 * to supabase.auth.signUp() anywhere in this codebase. Accounts exist only when
 * created in Supabase -> Authentication -> Users.
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      // Supabase returns a single generic message for both a wrong password and
      // an address that has no account, which is what you want -- a specific
      // message would confirm which addresses are registered.
      setError("That email and password combination didn't work.");
      setBusy(false);
      return;
    }

    const next = searchParams.get("next");
    router.replace(next && next.startsWith("/") ? next : "/");
    router.refresh();
  }

  return (
    <form className="login" onSubmit={onSubmit}>
      <h1>My Diary</h1>
      <p className="login__note">This diary is private. Sign in to continue.</p>

      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && (
        <p className="login__error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy}>
        {busy ? "Signing in\u2026" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary to avoid opting the whole route
  // into client-side rendering at build time.
  return (
    <Suspense fallback={<div className="login" />}>
      <LoginForm />
    </Suspense>
  );
}
