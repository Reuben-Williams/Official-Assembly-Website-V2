"use client";

import { useEffect, useState } from "react";

type State = "exchanging" | "ready" | "confirming" | "activation_pending" | "already_confirmed" | "unavailable";

async function exchangeFragmentToken(token: string): Promise<boolean> {
  const response = await fetch("/api/newsletter/confirmation-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
    credentials: "same-origin",
    referrerPolicy: "no-referrer"
  });
  return response.ok;
}

export function NewsletterConfirmationClient() {
  const [state, setState] = useState<State>("exchanging");

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("token");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!token || fragment.size !== 1) {
      void Promise.resolve().then(() => setState("unavailable"));
      return;
    }
    void exchangeFragmentToken(token)
      .then((ready) => setState(ready ? "ready" : "unavailable"))
      .catch(() => setState("unavailable"));
  }, []);

  async function confirm() {
    setState("confirming");
    try {
      const response = await fetch("/api/newsletter/confirm", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer"
      });
      const result: unknown = await response.json();
      const status = result && typeof result === "object"
        ? (result as Record<string, unknown>).status
        : null;
      if (status === "activation_pending" || status === "already_confirmed") {
        setState(status);
      } else {
        setState("unavailable");
      }
    } catch {
      setState("unavailable");
    }
  }

  if (state === "exchanging") return <p role="status">Checking your confirmation link…</p>;
  if (state === "unavailable") {
    return <p role="status">This confirmation link is unavailable or expired. You can submit the newsletter form again.</p>;
  }
  if (state === "activation_pending") {
    return <p role="status">Your confirmation was accepted. Newsletter activation is being completed.</p>;
  }
  if (state === "already_confirmed") {
    return <p role="status">This subscription was already confirmed. No additional action is needed.</p>;
  }
  return (
    <div>
      <p>Your link is valid. Confirm only if you requested the District Newsletter.</p>
      <button className="cta-link" type="button" onClick={confirm} disabled={state === "confirming"}>
        {state === "confirming" ? "Confirming…" : "Confirm subscription"}
      </button>
    </div>
  );
}
