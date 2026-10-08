"use client";
import { editorFetch } from '../../../lib/builder/editor-fetch';

import { useEffect, useMemo, useRef, useState } from "react";
import { builderSessionCookies } from "../../../lib/builder/session-cookies";
import type { CalendarTranslationClient, CalendarTranslationSource, CalendarTranslationSuggestion } from "../../../lib/calendar/translation-types";
import { CalendarDialog } from "./calendar-dialog";
import styles from "./calendar-workspace.module.css";

function httpClient(): CalendarTranslationClient {
  const url = "/api/builder/calendar/translation";
  return {
    async available() {
      const response = await editorFetch(url, { cache: "no-store", credentials: "same-origin" });
      return response.ok && (await response.json()).available === true;
    },
    async suggest(source) {
      const cookie = document.cookie.split(";").find(item => item.trim().startsWith(`${builderSessionCookies.csrf}=`));
      const token = cookie ? decodeURIComponent(cookie.trim().slice(builderSessionCookies.csrf.length + 1)) : "";
      if (!token) throw new Error("Refresh your editor session.");
      const response = await editorFetch(url, {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-builder-csrf": token },
        body: JSON.stringify({ confirmed: true, ...source })
      });
      if (!response.ok) throw new Error("The suggestion could not be completed. Your draft is unchanged.");
      return await response.json();
    }
  };
}

export function CalendarTranslation({ source, spanish, draftIdentity, onApply, client, disabled = false }: {
  source: CalendarTranslationSource; spanish: CalendarTranslationSuggestion; draftIdentity: string;
  onApply: (suggestion: CalendarTranslationSuggestion) => void; client?: CalendarTranslationClient; disabled?: boolean;
}) {
  const defaultClient = useMemo(() => httpClient(), []);
  const operations = client ?? defaultClient;
  const fingerprint = JSON.stringify([draftIdentity, source, spanish]);
  const currentFingerprint = useRef(fingerprint);
  useEffect(() => { currentFingerprint.current = fingerprint; }, [fingerprint]);
  const requestId = useRef(0);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [dialog, setDialog] = useState<{ fingerprint: string; source: CalendarTranslationSource; suggestion?: CalendarTranslationSuggestion } | null>(null);
  const [busy, setBusy] = useState(false);
  const [replacement, setReplacement] = useState(false);
  const [error, setError] = useState("");
  const needsReplacement = Object.values(spanish).some(text => text.trim());
  const activeDialog = dialog?.fingerprint === fingerprint ? dialog : null;

  useEffect(() => {
    let active = true;
    void operations.available().then(value => { if (active) setAvailable(value); })
      .catch(() => { if (active) setAvailable(false); });
    const requests = requestId;
    return () => { active = false; requests.current++; };
  }, [operations]);

  function close() { requestId.current++; setDialog(null); setBusy(false); setError(""); }
  async function suggest() {
    if (!activeDialog || busy) return;
    const snapshot = activeDialog;
    const id = ++requestId.current;
    setBusy(true); setError("");
    try {
      const result = await operations.suggest(snapshot.source);
      if (id !== requestId.current || currentFingerprint.current !== snapshot.fingerprint) return;
      setDialog({ ...snapshot, suggestion: result });
    } catch {
      if (id === requestId.current && currentFingerprint.current === snapshot.fingerprint)
        setError("The suggestion could not be completed. Your draft is unchanged.");
    } finally { if (id === requestId.current) setBusy(false); }
  }

  return <div>
    <button type="button" className={styles.secondaryButton} disabled={disabled || available !== true || !source.titleEn.trim() || !source.descriptionEn.trim()}
      onClick={() => { setReplacement(false); setError(""); setBusy(false); setDialog({ fingerprint, source: { ...source } }); }}>Suggest Spanish</button>
    <p className={styles.hint}>{available === null ? "Checking translation availability…" : available ? "Optional suggestion. Staff review and apply it before saving." : "Automatic translation provider is not configured. You can add Spanish manually or leave it blank for English fallback."}</p>
    {activeDialog ? <CalendarDialog title={activeDialog.suggestion ? "Review Spanish suggestion" : "Confirm translation request"} onClose={close}>
      {error ? <p role="alert">{error}</p> : null}
      {!activeDialog.suggestion ? <>
        <p>Only the English text below will be sent to Google Cloud Translation. It includes any names or contact details you put in these fields. Dates, location fields, links, and images are not sent.</p>
        <pre>{[activeDialog.source.titleEn, activeDialog.source.descriptionEn, activeDialog.source.actionLabelEn].filter(Boolean).join("\n\n")}</pre>
        <p>This does not save or publish the event.</p>
        <div className={styles.actions}><button type="button" onClick={close}>Cancel</button><button type="button" disabled={busy} onClick={() => void suggest()}>{busy ? "Requesting suggestion…" : "Confirm and suggest"}</button></div>
      </> : <>
        <p>Check the wording carefully. Applying only changes this unsaved draft.</p>
        {(["titleEs", "descriptionEs", "actionLabelEs"] as const).map((key, index) => <label key={key}>{["Suggested Spanish title", "Suggested Spanish description", "Suggested Spanish link label"][index]}
          <textarea maxLength={[160, 5000, 120][index]} rows={index === 1 ? 4 : 2} value={activeDialog.suggestion![key]} onChange={event => setDialog({ ...activeDialog, suggestion: { ...activeDialog.suggestion!, [key]: event.target.value } })} />
        </label>)}
        {needsReplacement ? <label className={styles.checkbox}><input type="checkbox" checked={replacement} onChange={event => setReplacement(event.target.checked)} />I approve replacing the existing Spanish text in this draft.</label> : null}
        <div className={styles.actions}><button type="button" onClick={close}>Cancel</button><button type="button" disabled={disabled || (needsReplacement && !replacement)} onClick={() => {
          if (currentFingerprint.current !== activeDialog.fingerprint || disabled) return;
          onApply(activeDialog.suggestion!); close();
        }}>Apply to draft</button></div>
      </>}
    </CalendarDialog> : null}
  </div>;
}
