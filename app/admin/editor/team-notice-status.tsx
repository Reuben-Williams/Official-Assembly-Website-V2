"use client";
import { useEffect, useState } from "react";
import { editorFetch } from "../../../lib/builder/editor-fetch";
import { builderSessionCookies } from "../../../lib/builder/session-cookies";

type NoticeStatus = { enabled: boolean; pending: number; accepted: number; delivered: number; failed: number; reviewRequired: number; reviewJobs: { id: string; safeCode: string; outcome: string }[] };
export function TeamNoticeStatus() {
  const [status, setStatus] = useState<NoticeStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void editorFetch("/api/team-notices/status", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("unavailable");
      const value = await response.json(); if (active) setStatus(value);
    }).catch(() => { if (active) setMessage("Team notice status is temporarily unavailable. Your submissions are unchanged."); });
    return () => { active = false; };
  }, []);
  async function investigate(jobId: string) {
    setBusy(true); setMessage("");
    try {
      const csrf = document.cookie.split(";").map(v => v.trim()).find(v => v.startsWith(`${builderSessionCookies.csrf}=`))?.split("=").slice(1).join("=") ?? "";
      const response = await editorFetch("/api/team-notices/status", { method: "POST", headers: { "content-type": "application/json", "x-builder-csrf": decodeURIComponent(csrf) }, body: JSON.stringify({ jobId }) });
      if (!response.ok) throw new Error("unavailable");
      setMessage("Delivery investigation recorded. No email was resent. Contact the site administrator to review provider evidence.");
    } catch { setMessage("The investigation could not be recorded. No email was resent."); }
    finally { setBusy(false); }
  }
  return <section className="newsletter-inventory" aria-labelledby="team-notice-title">
    <h2 id="team-notice-title">Website team notices</h2>
    <p>Brief notices go to <strong>aswcmoralesteam@gmail.com</strong>. Resident details stay in the secure Staff Portal.</p>
    {status ? <><p>{status.enabled ? "Active for new submissions" : "Not activated"} · {status.pending} pending · {status.accepted} provider accepted · {status.delivered} delivered · {status.failed} failed · {status.reviewRequired} need review</p>
      <p>Delivered means the receiving mail server accepted it; Inbox placement is not guaranteed.</p>
      {status.reviewJobs.map(job => <p key={job.id}>{job.safeCode.replaceAll("_", " ")} <button type="button" disabled={busy} onClick={() => void investigate(job.id)}>Record delivery investigation</button></p>)}</> : <p role="status">{message || "Loading team notice status…"}</p>}
    {status && message ? <p role="status">{message}</p> : null}
  </section>;
}
