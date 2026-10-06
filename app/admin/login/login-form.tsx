"use client";

import { useEffect, useState, type FormEvent } from "react";

import { getSupabaseBrowserClient } from "../../../lib/supabase/client";

export function LoginForm({ returnTo, complete = false }: { returnTo: string; complete?: boolean }) {
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

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
    if (submitting || cooldown > 0) return;
    const values = new FormData(event.currentTarget);
    setSubmitting(true);
    setCooldown(60);
    setStatus("Sending a secure sign-in link…");
    try {
      const response = await fetch("/api/builder/sign-in", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: String(values.get("email") ?? ""), returnTo }),
        signal: AbortSignal.timeout(30000)
      });
      setStatus(response.ok
        ? "If this address has staff access, a secure sign-in link will arrive shortly."
        : "Staff sign-in is temporarily unavailable. Please wait before trying again.");
    } catch {
      setStatus("Staff sign-in is temporarily unavailable. Please wait before trying again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="admin-login-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="editor-email">Email address</label>
        <input autoComplete="email" id="editor-email" name="email" required type="email" />
      </div>
      <button className="cta-link" disabled={submitting || cooldown > 0} type="submit">
        {cooldown > 0 ? `Please wait ${cooldown}s` : "Send secure sign-in link"}
      </button>
      <p aria-live="polite" className="form-note">{status}</p>
    </form>
  );
}
