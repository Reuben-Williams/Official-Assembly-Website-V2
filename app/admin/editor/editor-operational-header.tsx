"use client";

import { useState } from "react";

export function EditorOperationalHeader() {
  const [endingSession, setEndingSession] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setEndingSession(true);
    setError("");
    try {
      const response = await fetch("/api/builder/session", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store"
      });
      if (!response.ok) throw new Error("The editor session could not be revoked. Try again.");
      window.location.replace("/admin/login");
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : "The editor session could not be revoked. Try again.");
      setEndingSession(false);
    }
  }

  return (
    <section className="editor-operational-header" aria-label="Editor operational status">
      <div className="editor-operational-summary">
        <strong>Live production data</strong>
        <span>Resend newsletter</span>
        <span>Survey unavailable</span>
      </div>
      <details className="editor-operational-details">
        <summary>Details</summary>
        <div>
          <p>
            Contact uses an approved managed-form template. Newsletter email uses Resend with explicit
            confirmation and guarded Broadcast validation. Posts use the provisioned live content store.
            The survey remains unavailable until separately approved and provisioned.
          </p>
          <p>
            Dashboard, submissions, leads, and customers use live production storage. No synthetic
            or placeholder records are loaded. SMS and AI actions remain unavailable because their
            external providers are not configured.
          </p>
        </div>
      </details>
      <button disabled={endingSession} onClick={signOut} type="button">
        {endingSession ? "Ending session…" : "Sign out and revoke editor session"}
      </button>
      {error ? <p className="editor-operational-error" role="alert">{error}</p> : null}
    </section>
  );
}
