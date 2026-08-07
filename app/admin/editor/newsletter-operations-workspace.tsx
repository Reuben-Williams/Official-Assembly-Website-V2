"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createNewsletterOperationsClient,
  type NewsletterOperationsClient,
  type NewsletterProviderInventoryStatus,
  type NewsletterOperationsStatus
} from "../../../lib/newsletter/operations-client";
import { builderSessionCookies } from "../../../lib/builder/session-cookies";

type Role = "owner" | "editor" | "contributor" | "viewer";

function csrfCookie() {
  for (const item of document.cookie.split(";")) {
    const [name, ...rest] = item.trim().split("=");
    if (name === builderSessionCookies.csrf) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function digest(value: string) {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value || "Not recorded";
}

function localTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "Not recorded";
}

export function NewsletterOperationsWorkspace({
  role,
  client
}: {
  readonly role: Role;
  readonly client?: NewsletterOperationsClient;
}) {
  const defaultClient = useMemo(() => createNewsletterOperationsClient(csrfCookie), []);
  const operations = client ?? defaultClient;
  const [status, setStatus] = useState<NewsletterOperationsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [broadcastId, setBroadcastId] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [inventory, setInventory] = useState<NewsletterProviderInventoryStatus | null>(null);
  const owner = role === "owner";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await operations.status());
    } catch {
      setStatus(null);
      setError("Newsletter status is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [operations]);

  useEffect(() => {
    let active = true;
    void operations.status().then((nextStatus) => {
      if (!active) return;
      setStatus(nextStatus);
      setError("");
    }).catch(() => {
      if (!active) return;
      setStatus(null);
      setError("Newsletter status is temporarily unavailable.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [operations]);

  async function run(name: string, task: () => Promise<Record<string, unknown>>, success: string) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      const result = await task();
      setNotice(result.state === "pending"
        ? "A fresh audience reconciliation is queued. Retry this operation after the protected worker completes."
        : success);
      await refresh();
    } catch {
      setError("The newsletter operation could not be completed. Review readiness and try again.");
    } finally {
      setBusy("");
    }
  }

  async function runProviderInventory() {
    setBusy("inventory");
    setError("");
    setNotice("");
    try {
      const result = await operations.providerInventory();
      setInventory(result);
      setNotice(result.state === "ready"
        ? "The read-only provider inventory satisfies its current policy."
        : "The read-only provider inventory found setup items that must be resolved before activation.");
    } catch {
      setInventory(null);
      setError("The provider inventory could not be completed. No provider changes were made.");
    } finally {
      setBusy("");
    }
  }

  function readableCode(value: string) {
    return value.replaceAll("_", " ");
  }

  const normalizedBroadcastId = broadcastId.trim();
  const hasIncident = (status?.openIncidents ?? 0) > 0;
  const circuitOpen = status?.reconciliationCircuit.state === "open";
  const canValidate = Boolean(status?.confirmedTest) && !hasIncident && normalizedBroadcastId.length >= 3;

  return (
    <section className="newsletter-operations" data-newsletter-operations-workspace>
      <header className="newsletter-operations-hero">
        <div>
          <p className="newsletter-operations-eyebrow">Forms · live production</p>
          <h1>Newsletter operations</h1>
          <p>
            Review signup readiness and guarded send evidence here. Compose and perform any final
            Broadcast send only in Resend.
          </p>
        </div>
        <span className={hasIncident ? "newsletter-state newsletter-state-danger" : "newsletter-state"}>
          {hasIncident ? "Incident lockout" : "Live status"}
        </span>
      </header>

      {!owner ? <p className="newsletter-readonly">Read-only access · operational changes require the site owner.</p> : null}
      {loading ? <p className="newsletter-loading" role="status">Loading live newsletter status…</p> : null}
      {error ? <p className="newsletter-operation-error" role="alert">{error}</p> : null}
      {notice ? <p className="newsletter-operation-notice" role="status">{notice}</p> : null}

      {status ? (
        <div className="newsletter-status-grid" aria-label="Newsletter status summary">
          <article>
            <span>Delivery queue</span>
            <strong>{status.queuedJobs} queued jobs</strong>
            <p>Durable confirmation and provider-sync work.</p>
          </article>
          <article>
            <span>Broadcast incidents</span>
            <strong>{status.openIncidents} open</strong>
            <p>{hasIncident ? "Validation is locked until incidents are resolved." : "No current send-evidence lockout."}</p>
          </article>
          <article>
            <span>Provider activation</span>
            <strong>{status.providerActivation.active ? "Active" : "Not active"}</strong>
            <p>{status.providerActivation.active
              ? `Recorded ${localTime(status.providerActivation.recordedAt)}`
              : "Required before audience reconciliation can run."}</p>
          </article>
          <article>
            <span>Dashboard review</span>
            <strong>{status.providerAttestation.current ? "Current" : "Required"}</strong>
            <p>{status.providerAttestation.current
              ? `Expires ${localTime(status.providerAttestation.expiresAt)}`
              : "Owner review is limited to non-API account settings."}</p>
          </article>
          <article>
            <span>Confirmed staff test</span>
            <strong>{status.confirmedTest ? digest(status.confirmedTest.digest) : "Required"}</strong>
            <p>{status.confirmedTest ? `Observed ${localTime(status.confirmedTest.confirmedAt)}` : "Open a bounded window before the Resend test."}</p>
          </article>
          <article>
            <span>Send validation</span>
            <strong>{status.validation ? `${status.validation.audienceCount} confirmed subscribers` : "Not validated"}</strong>
            <p>{status.validation ? `Expires ${localTime(status.validation.validUntil)} · ${digest(status.validation.digest)}` : "Approvals expire after ten minutes."}</p>
          </article>
        </div>
      ) : null}

      {owner ? (
        <section className="newsletter-operations-panel" aria-label="Provider readiness controls">
          <div className="newsletter-control-copy">
            <p className="newsletter-operations-eyebrow">Read-only provider readiness</p>
            <h2>Audit the dedicated Resend team</h2>
            <p>
              This checks provider resources and local evidence without sending email or changing
              Contacts, Segments, Topics, webhooks, keys, or Broadcasts.
            </p>
          </div>
          <div className="newsletter-operation-actions">
            <button
              disabled={Boolean(busy)}
              onClick={() => void runProviderInventory()}
              type="button"
            >{busy === "inventory" ? "Auditing provider…" : "Run provider inventory"}</button>
            <button
              disabled={Boolean(busy)}
              onClick={() => void run(
                "attestation",
                () => operations.recordProviderAttestation(crypto.randomUUID()),
                "The bounded owner dashboard review was recorded for thirty days."
              )}
              type="button"
            >{busy === "attestation" ? "Recording review…" : "Confirm dashboard review"}</button>
            <button
              disabled={Boolean(busy) || !inventory?.activationReady || status?.providerActivation.active === true}
              onClick={() => void run(
                "provider-activation",
                () => operations.activateProvider(crypto.randomUUID()),
                "The dedicated provider boundary is active. No email was sent."
              )}
              type="button"
            >{busy === "provider-activation" ? "Activating boundary…" : "Activate provider boundary"}</button>
          </div>
          {inventory ? (
            <div className="newsletter-inventory-results" aria-label="Provider inventory results">
              <p>
                <strong>{inventory.state === "ready" ? "Policy ready" : "Setup blocked"}</strong>
                {` · ${readableCode(inventory.mode)} · ${inventory.categories.length} categories`}
              </p>
              <ul>
                {inventory.categories.map((item) => (
                  <li data-state={item.status} key={item.category}>
                    <span>{readableCode(item.category)}</span>
                    <strong>{readableCode(item.code)}</strong>
                    <small>{item.count} records</small>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {owner && circuitOpen ? (
        <section className="newsletter-operations-panel" aria-label="Reconciliation recovery controls">
          <div className="newsletter-control-copy">
            <p className="newsletter-operations-eyebrow">Owner recovery</p>
            <h2>Review the reconciliation incident</h2>
            <p>
              Recovery closes the current circuit and queues a new full reconciliation from the
              beginning. It does not send email.
            </p>
          </div>
          <label>
            Recovery reason
            <input
              autoComplete="off"
              maxLength={500}
              onChange={(event) => setRecoveryReason(event.currentTarget.value)}
              value={recoveryReason}
            />
          </label>
          <div className="newsletter-operation-actions">
            <button
              disabled={Boolean(busy) || recoveryReason.trim().length < 1}
              onClick={() => void run(
                "recovery",
                () => operations.recoverReconciliation(crypto.randomUUID(), recoveryReason.trim()),
                "The reconciliation circuit was recovered and a fresh run was queued."
              )}
              type="button"
            >{busy === "recovery" ? "Queuing recovery…" : "Recover reconciliation"}</button>
          </div>
        </section>
      ) : null}

      {owner ? (
        <section className="newsletter-operations-panel" aria-label="Owner newsletter controls">
          <div className="newsletter-control-copy">
            <p className="newsletter-operations-eyebrow">Guarded Broadcast workflow</p>
            <h2>Validate an existing Resend draft</h2>
            <p>
              These controls inspect a draft and record short-lived evidence. They cannot create,
              update, schedule, or send a Broadcast.
            </p>
          </div>
          <label>
            Resend Broadcast ID
            <input
              autoComplete="off"
              maxLength={200}
              onChange={(event) => setBroadcastId(event.currentTarget.value)}
              placeholder="broadcast_…"
              spellCheck={false}
              value={broadcastId}
            />
          </label>
          <div className="newsletter-operation-actions">
            <button
              disabled={Boolean(busy) || normalizedBroadcastId.length < 3}
              onClick={() => void run("check", () => operations.activationCheck(normalizedBroadcastId), "Draft readiness checked.")}
              type="button"
            >{busy === "check" ? "Checking…" : "Run activation check"}</button>
            <button
              disabled={Boolean(busy) || hasIncident || normalizedBroadcastId.length < 3}
              onClick={() => void run(
                "test",
                () => operations.openStaffTestWindow(normalizedBroadcastId, crypto.randomUUID()),
                "Staff-test window opened for the server allowlist."
              )}
              type="button"
            >{busy === "test" ? "Opening…" : "Open staff test window"}</button>
            <button
              disabled={Boolean(busy) || !canValidate}
              onClick={() => void run(
                "validate",
                () => operations.validate(normalizedBroadcastId, crypto.randomUUID(), status!.confirmedTest!.id),
                "Newsletter validation recorded for ten minutes."
              )}
              type="button"
            >{busy === "validate" ? "Validating…" : "Validate newsletter"}</button>
            <a href="https://resend.com/broadcasts" rel="noreferrer" target="_blank">Open Resend</a>
          </div>
          {!status?.confirmedTest ? <p className="newsletter-control-hint">A confirmed exact-digest staff test is required before validation.</p> : null}
        </section>
      ) : null}
    </section>
  );
}
