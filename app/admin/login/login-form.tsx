"use client";

import { useEffect, useState, type FormEvent } from "react";

import { getSupabaseBrowserClient } from "../../../lib/supabase/client";

export function LoginForm({ returnTo, complete = false }: { returnTo: string; complete?: boolean }) {
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!complete) return;
    let active = true;
    async function finishSignIn() {
      const client = getSupabaseBrowserClient();
      if (!client) {
        if (active) setStatus("Editor sign-in is not configured for this environment.");
        return;
      }
      if (active) {
        setSubmitting(true);
        setStatus("Opening the staff portal…");
      }
      const response = await fetch("/api/builder/session", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store"
      });
      if (!active) return;
      if (!response.ok) {
        await client.auth.signOut();
        setSubmitting(false);
        setStatus("This account does not have access to the site editor.");
        return;
      }
      window.location.replace(returnTo);
    }
    void finishSignIn();
    return () => {
      active = false;
    };
  }, [complete, returnTo]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabaseBrowserClient();
    if (!client) {
      setStatus("Editor sign-in is not configured for this environment.");
      return;
    }
    const values = new FormData(event.currentTarget);
    setSubmitting(true);
    setStatus("Sending a secure sign-in link…");
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", returnTo);
    const { error } = await client.auth.signInWithOtp({
      email: String(values.get("email") ?? ""),
      options: {
        emailRedirectTo: callback.toString(),
        shouldCreateUser: false
      }
    });
    if (error) {
      setSubmitting(false);
      setStatus("A sign-in link could not be sent. Confirm the address and try again.");
      return;
    }
    setStatus("Check your email for the secure staff sign-in link.");
  }

  return (
    <form className="admin-login-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="editor-email">Email address</label>
        <input autoComplete="email" id="editor-email" name="email" required type="email" />
      </div>
      <button className="cta-link" disabled={submitting} type="submit">
        Send secure sign-in link
      </button>
      <p aria-live="polite" className="form-note">{status}</p>
    </form>
  );
}
