"use client";

import { useActionState } from "react";

/**
 * A form whose server action result is actually shown.
 *
 * Passing a server action straight to <form action={...}> discards whatever it
 * returns, so every validation failure and database error looked like a
 * success: an over-long first line simply did not save, and the "you cannot
 * change your own role" guard fired invisibly. useActionState keeps the result
 * so it can be rendered.
 *
 * The action must take (prevState, formData).
 */
export default function ActionForm({ action, children, className }) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className={className} data-pending={pending || undefined}>
      {children}
      {state && !state.ok && (
        <span className="actionform__error" role="alert">
          {state.message}
        </span>
      )}
      {state?.ok && (
        <span className="actionform__ok" aria-live="polite">
          {state.message ?? "Saved."}
        </span>
      )}
    </form>
  );
}
