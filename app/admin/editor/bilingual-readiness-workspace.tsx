"use client";

import type {
  LocalizationBlockerV1,
  LocalizedDomainRevisionV1,
  LocalizedTextV1,
} from "@reuben-williams/content";
import { canBuilderRole, type BuilderRole } from "@reuben-williams/core";
import {
  LocalizedFieldEditor,
  ReadinessWorkspace,
} from "@reuben-williams/editor";
import { useCallback, useEffect, useMemo, useState } from "react";

import localizationInventory from "../../../content/localization/inventory.json";
import {
  domainReadCapability,
  domainEditCapability,
  domainPublishCapability,
  type LocalizationInventoryItem,
} from "../../../lib/builder/localization";
import { builderSessionCookies } from "../../../lib/builder/session-cookies";

type InventoryStatus = "missing" | "draft" | "needs_review" | "approved" | "language_neutral" | "stale";

type WorkspaceInventoryItem = LocalizationInventoryItem & {
  readonly status: InventoryStatus;
};

const inventory = localizationInventory.items as WorkspaceInventoryItem[];

type WorkspaceRevisionRow = {
  readonly revision_id: string;
  readonly domain: string;
  readonly stable_id: string;
  readonly snapshot: LocalizedDomainRevisionV1;
  readonly bilingual_ready: boolean;
  readonly created_at: string;
};

type PublicationState = {
  readonly published_composition_id: string | null;
  readonly published_sequence: number;
  readonly bilingual_active: boolean;
  readonly lock_version: number;
  readonly updated_at: string;
};

type CompositionPublication = {
  readonly publication_sequence: number;
  readonly composition_id: string;
  readonly composition_digest: string;
  readonly published_at: string;
};

type CompositionCandidate = {
  readonly composition_id: string;
  readonly composition_digest: string;
  readonly base_composition_id: string;
  readonly intended_delta: {
    readonly kind?: string;
    readonly domain?: string;
  } | null;
  readonly created_at: string;
};

type RecoveryPointer = {
  readonly publication_sequence: number;
  readonly composition_id: string;
  readonly composition_digest: string;
  readonly artifact_digest: string;
  readonly updated_at: string;
};

type BilingualWorkspaceSnapshot = {
  readonly revisions: readonly WorkspaceRevisionRow[];
  readonly blockers: readonly LocalizationBlockerV1[];
  readonly publications: readonly CompositionPublication[];
  readonly candidates: readonly CompositionCandidate[];
  readonly publicationState: PublicationState | null;
  readonly recoveryPointer: RecoveryPointer | null;
};

type StagedComposition = {
  readonly candidateCompositionId: string;
  readonly candidateCompositionDigest: string;
  readonly lockVersion: number;
  readonly kind: "domain" | "restore";
  readonly domain?: WorkspaceInventoryItem["domain"];
};

function blockerCode(status: InventoryStatus): LocalizationBlockerV1["code"] | null {
  if (status === "missing") return "TRANSLATION_MISSING";
  if (status === "draft") return "TRANSLATION_DRAFT";
  if (status === "needs_review") return "TRANSLATION_NEEDS_REVIEW";
  if (status === "stale") return "TRANSLATION_STALE";
  return null;
}

function itemBlocker(item: WorkspaceInventoryItem): LocalizationBlockerV1 | null {
  const code = blockerCode(item.status);
  return code ? {
    code,
    domain: item.domain,
    stableId: item.stableId,
    fieldId: item.fieldId,
  } : null;
}

function fieldValue(item: WorkspaceInventoryItem, spanish: string): LocalizedTextV1 {
  const status = item.status as InventoryStatus;
  if (!spanish.trim()) {
    return {
      schemaVersion: 1,
      fieldId: item.fieldId,
      en: item.english,
      es: { mode: "missing", sourceDigest: item.sourceDigest },
    };
  }
  return {
    schemaVersion: 1,
    fieldId: item.fieldId,
    en: item.english,
    es: {
      mode: "translated",
      status: status === "draft" ? "draft" : "needs_review",
      value: spanish,
      origin: "migrated",
      sourceDigest: item.sourceDigest,
      updatedBy: "inventory.migration",
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
  };
}

function visibleFieldValue(
  item: WorkspaceInventoryItem,
  persisted: LocalizedTextV1 | null,
  spanish: string,
  hasLocalDraft: boolean,
): LocalizedTextV1 {
  if (!hasLocalDraft) return persisted ?? fieldValue(item, spanish);
  return {
    schemaVersion: 1,
    fieldId: item.fieldId,
    en: persisted?.en ?? item.english,
    es: {
      mode: "translated",
      status: "draft",
      value: spanish,
      origin: "manual",
      sourceDigest: item.sourceDigest,
      updatedBy: "current.editor",
      updatedAt: new Date().toISOString(),
    },
  };
}

function csrfCookie() {
  for (const item of document.cookie.split(";")) {
    const [name, ...rest] = item.trim().split("=");
    if (name === builderSessionCookies.csrf) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function sourcePage(item: WorkspaceInventoryItem): string | null {
  const match = item.source.match(/(?:^|,)public_html:([^,]+)/u);
  if (!match?.[1]) return null;
  const path = match[1].trim();
  return path.startsWith("/") && !path.includes("__bilingual-inventory-404__") ? path : null;
}

export function BilingualReadinessWorkspace({
  currentPath,
  onOpenPage,
  previewBaseUrl,
  role,
}: {
  readonly currentPath: string;
  readonly onOpenPage: (path: string) => void;
  readonly previewBaseUrl: string;
  readonly role: BuilderRole;
}) {
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const [spanishDrafts, setSpanishDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [workspace, setWorkspace] = useState<BilingualWorkspaceSnapshot | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [staged, setStaged] = useState<StagedComposition | null>(null);
  const inventoryBlockers = useMemo(() => inventory.flatMap((item) => {
    if (!canBuilderRole(role, domainReadCapability(item.domain))) return [];
    const blocker = itemBlocker(item);
    return blocker ? [blocker] : [];
  }), [role]);
  const importedGroups = useMemo(() => new Set((workspace?.revisions ?? []).map(
    (revision) => `${revision.domain}:${revision.stable_id}`,
  )), [workspace]);
  const blockers = useMemo(() => workspace
    ? [
        ...inventoryBlockers.filter((blocker) => !importedGroups.has(`${blocker.domain}:${blocker.stableId}`)),
        ...workspace.blockers,
      ]
    : inventoryBlockers, [importedGroups, inventoryBlockers, workspace]);
  const itemByIdentity = useMemo(() => new Map(inventory.map((item) => [
    `${item.domain}:${item.stableId}:${item.fieldId}`,
    item,
  ])), []);
  const persistedFields = useMemo(() => {
    const fields = new Map<string, LocalizedTextV1>();
    for (const revision of workspace?.revisions ?? []) {
      for (const field of revision.snapshot.fields) {
        if (field.kind === "text") {
          fields.set(`${revision.domain}:${revision.stable_id}:${field.value.fieldId}`, field.value);
        }
      }
    }
    return fields;
  }, [workspace]);
  const selected = selectedIdentity ? itemByIdentity.get(selectedIdentity) ?? null : null;
  const persistedSelected = selectedIdentity ? persistedFields.get(selectedIdentity) ?? null : null;
  const selectedSpanish = selected
    ? spanishDrafts[selectedIdentity!]
      ?? (persistedSelected?.es.mode === "translated" ? persistedSelected.es.value : selected.spanish ?? "")
    : "";
  const selectedHasLocalDraft = selectedIdentity ? Object.hasOwn(spanishDrafts, selectedIdentity) : false;
  const selectedRevision = selected ? workspace?.revisions.find(
    (revision) => revision.domain === selected.domain && revision.stable_id === selected.stableId,
  ) ?? null : null;
  const canEdit = selected
    ? canBuilderRole(role, "translations.editDraft") && canBuilderRole(role, domainEditCapability(selected.domain))
    : false;
  const canApprove = selected
    ? canBuilderRole(role, "translations.approve") && canBuilderRole(role, domainEditCapability(selected.domain))
    : false;
  const canPublish = selected
    ? canBuilderRole(role, domainPublishCapability(selected.domain))
    : false;
  const canStage = selected
    ? canBuilderRole(role, domainEditCapability(selected.domain))
    : false;
  const canRestore = canBuilderRole(role, "post.rollback");
  const recoveredCandidate = workspace?.candidates.find((candidate) => {
    if (candidate.intended_delta?.kind === "restore") return canRestore;
    const domain = candidate.intended_delta?.domain;
    return domain && canBuilderRole(role, domainPublishCapability(domain as WorkspaceInventoryItem["domain"]));
  }) ?? null;
  const publishCandidate = staged ?? (recoveredCandidate ? {
    candidateCompositionId: recoveredCandidate.composition_id,
    candidateCompositionDigest: recoveredCandidate.composition_digest,
    lockVersion: workspace?.publicationState?.lock_version ?? 0,
    kind: recoveredCandidate.intended_delta?.kind === "restore" ? "restore" as const : "domain" as const,
    ...(recoveredCandidate.intended_delta?.domain
      ? { domain: recoveredCandidate.intended_delta.domain as WorkspaceInventoryItem["domain"] }
      : {}),
  } : null);
  const canPublishCandidate = publishCandidate?.kind === "restore"
    ? canRestore
    : Boolean(publishCandidate?.domain && canBuilderRole(role, domainPublishCapability(publishCandidate.domain)));

  const loadWorkspace = useCallback(async () => {
    try {
      const response = await fetch("/api/builder/localization", { headers: { accept: "application/json" } });
      const body = await response.json() as Partial<BilingualWorkspaceSnapshot> & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Bilingual readiness could not be loaded.");
      if (!Array.isArray(body.revisions) || !Array.isArray(body.blockers) ||
          !Array.isArray(body.publications) || !Array.isArray(body.candidates)) {
        throw new Error("Bilingual readiness returned an invalid response.");
      }
      setWorkspace({
        revisions: body.revisions,
        blockers: body.blockers,
        publications: body.publications,
        candidates: body.candidates,
        publicationState: body.publicationState ?? null,
        recoveryPointer: body.recoveryPointer ?? null,
      });
      setWorkspaceError("");
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Bilingual readiness could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWorkspace(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  async function mutate(operation: "save_draft" | "submit_review" | "approve") {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/builder/localization", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-builder-csrf": csrfCookie() ?? "",
          "x-idempotency-key": `localization:${operation}:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          operation,
          domain: selected.domain,
          stableId: selected.stableId,
          fieldId: selected.fieldId,
          ...(operation === "save_draft" ? { spanish: selectedSpanish } : {}),
        }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The Spanish workflow could not be completed.");
      setSpanishDrafts((current) => {
        const next = { ...current };
        delete next[selectedIdentity!];
        return next;
      });
      await loadWorkspace();
      setMessage(operation === "approve"
        ? "Spanish approved. Publish remains a separate composition step."
        : operation === "submit_review"
          ? "Spanish submitted for review."
          : "Spanish draft saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Spanish workflow could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function compositionCommand(
    operation: "stage" | "publish" | "restore",
    payload: Record<string, unknown>,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/builder/localization", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-builder-csrf": csrfCookie() ?? "",
          "x-idempotency-key": `localization:${operation}:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ operation, ...payload }),
      });
      const body = await response.json() as StagedComposition & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The composition action could not be completed.");
      if (operation === "stage" || operation === "restore") {
        setStaged({
          ...body,
          kind: operation === "restore" ? "restore" : "domain",
          ...(operation === "stage" && selected ? { domain: selected.domain } : {}),
        });
        setMessage(operation === "restore"
          ? "A restoration candidate was created. Review both locale previews before publishing it."
          : "The approved revision is staged. Review both locale previews before publishing.");
      } else {
        setStaged(null);
        setMessage("The bilingual composition was published. Recovery evidence is being reconciled.");
      }
      await loadWorkspace();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The composition action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  function preview(locale: "en" | "es") {
    const url = new URL(currentPath, previewBaseUrl);
    url.searchParams.set("builderPreview", "1");
    url.searchParams.set("builderLocale", locale);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="bilingual-readiness-workspace" data-builder-bilingual-workspace>
      <header>
        <p className="editor-live-data-label"><strong>Approval-gated bilingual publishing</strong></p>
        <h1>Bilingual readiness</h1>
        <p>Draft and review Spanish beside its English source. Public composition publishing and one-time activation stay separate.</p>
        <div className="bilingual-preview-actions" aria-label="Locale previews">
          <button type="button" onClick={() => preview("en")}>Preview English</button>
          <button type="button" onClick={() => preview("es")}>Preview Spanish</button>
        </div>
      </header>
      <ReadinessWorkspace
        blockers={blockers}
        onOpenBlocker={(blocker) => setSelectedIdentity(
          `${blocker.domain}:${blocker.stableId}:${blocker.fieldId}`,
        )}
      />
      {selected ? (
        <section className="bilingual-field-panel" aria-label="Selected bilingual field">
          <LocalizedFieldEditor
            label={selected.stableId}
            value={visibleFieldValue(
              selected,
              persistedSelected,
              selectedSpanish,
              selectedHasLocalDraft,
            )}
            required
            canEdit={canEdit && !busy}
            canApprove={canApprove && !busy && !selectedHasLocalDraft}
            onSpanishChange={(spanish) => setSpanishDrafts((current) => ({
              ...current,
              [selectedIdentity!]: spanish,
            }))}
            onSubmitForReview={() => { void mutate("submit_review"); }}
            onApprove={() => { void mutate("approve"); }}
          />
          <div className="bilingual-field-actions">
            {canEdit ? <button type="button" disabled={busy || !selectedSpanish.trim()} onClick={() => { void mutate("save_draft"); }}>Save Spanish draft</button> : null}
            {sourcePage(selected) ? <button type="button" onClick={() => onOpenPage(sourcePage(selected)!)}>Open editable page</button> : null}
          </div>
          {message ? <p role="status">{message}</p> : null}
        </section>
      ) : null}
      <section className="bilingual-composition-panel" aria-labelledby="bilingual-composition-title">
        <h2 id="bilingual-composition-title">Composition publishing</h2>
        <p>Approved Spanish becomes public only through a staged, reviewed site composition. Activation is intentionally unavailable here.</p>
        {!workspace?.publicationState?.published_composition_id ? (
          <p>The initial composition must be established by the separately approved content import before editor publishing is enabled.</p>
        ) : null}
        {selectedRevision?.bilingual_ready && workspace?.publicationState?.published_composition_id && canStage ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => { void compositionCommand("stage", {
              expectedLockVersion: workspace.publicationState!.lock_version,
              expectedCurrentCompositionId: workspace.publicationState!.published_composition_id,
              candidateRevisionId: selectedRevision.revision_id,
              dependencyRevisionIds: [],
            }); }}
          >Stage approved revision</button>
        ) : null}
        {publishCandidate && canPublishCandidate ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => { void compositionCommand("publish", {
              expectedLockVersion: publishCandidate.lockVersion,
              expectedCurrentCompositionId: workspace?.publicationState?.published_composition_id ?? null,
              candidateCompositionId: publishCandidate.candidateCompositionId,
              candidateCompositionDigest: publishCandidate.candidateCompositionDigest,
            }); }}
          >Publish staged composition</button>
        ) : null}
        {canRestore && workspace?.publicationState?.published_composition_id ? (
          <ul aria-label="Restorable site compositions">
            {workspace.publications
              .filter((publication) => publication.composition_id !== workspace.publicationState!.published_composition_id)
              .slice(0, 5)
              .map((publication) => (
                <li key={publication.composition_id}>
                  <span>Version {publication.publication_sequence}</span>
                  <button type="button" disabled={busy} onClick={() => { void compositionCommand("restore", {
                    expectedLockVersion: workspace.publicationState!.lock_version,
                    expectedCurrentCompositionId: workspace.publicationState!.published_composition_id,
                    targetCompositionId: publication.composition_id,
                  }); }}>Prepare restoration</button>
                </li>
              ))}
          </ul>
        ) : null}
      </section>
      <section className="bilingual-recovery-panel" aria-labelledby="bilingual-recovery-title">
        <h2 id="bilingual-recovery-title">Complete composition recovery</h2>
        {workspace?.recoveryPointer ? (
          <dl>
            <div><dt>Recovered publication</dt><dd>{workspace.recoveryPointer.publication_sequence}</dd></div>
            <div><dt>Composition digest</dt><dd><code>{workspace.recoveryPointer.composition_digest}</code></dd></div>
            <div><dt>Artifact digest</dt><dd><code>{workspace.recoveryPointer.artifact_digest}</code></dd></div>
            <div><dt>Reconciled</dt><dd>{new Date(workspace.recoveryPointer.updated_at).toLocaleString()}</dd></div>
          </dl>
        ) : <p>No complete composition recovery evidence has been recorded yet.</p>}
      </section>
      {workspaceError ? <p className="bilingual-workspace-error" role="alert">{workspaceError}</p> : null}
    </section>
  );
}
