"use client";

export type NewsletterOperationsStatus = {
  readonly version: 1;
  readonly queuedJobs: number;
  readonly openIncidents: number;
  readonly providerActivation: {
    readonly active: boolean;
    readonly recordedAt: string;
  };
  readonly providerAttestation: {
    readonly current: boolean;
    readonly expiresAt: string;
  };
  readonly authSmtpProofs: {
    readonly replacementLogin: boolean;
    readonly postRevocationLogin: boolean;
  };
  readonly reconciliationCircuit: {
    readonly state: "closed" | "open";
    readonly code: string;
  };
  readonly confirmedTest: null | {
    readonly id: string;
    readonly providerBroadcastId: string;
    readonly digest: string;
    readonly confirmedAt: string;
  };
  readonly validation: null | {
    readonly id: string;
    readonly providerBroadcastId: string;
    readonly digest: string;
    readonly audienceCount: number;
    readonly validatedAt: string;
    readonly validUntil: string;
    readonly state: string;
    readonly readinessRevisionId: string;
  };
};

export type NewsletterProviderInventoryStatus = {
  readonly state: "ready" | "blocked";
  readonly activationReady: boolean;
  readonly mode: "disabled_setup" | "initial" | "steady";
  readonly policyVersion: string;
  readonly categories: readonly {
    readonly category: string;
    readonly status: "ready" | "blocked";
    readonly code: string;
    readonly count: number;
  }[];
  readonly counts: {
    readonly contacts: number;
    readonly segmentContacts: number;
    readonly suppressions: number;
    readonly broadcasts: number;
    readonly sentBroadcasts: number;
    readonly emails: number;
    readonly localEligible: number;
  };
};

export interface NewsletterOperationsClient {
  status(): Promise<NewsletterOperationsStatus>;
  providerInventory(): Promise<NewsletterProviderInventoryStatus>;
  recordProviderAttestation(commandId: string): Promise<Record<string, unknown>>;
  recordAuthSmtpProof(
    commandId: string,
    phase: "replacement_login" | "post_revocation_login"
  ): Promise<Record<string, unknown>>;
  activateProvider(commandId: string): Promise<Record<string, unknown>>;
  recoverReconciliation(commandId: string, reason: string): Promise<Record<string, unknown>>;
  activationCheck(broadcastId: string): Promise<Record<string, unknown>>;
  openStaffTestWindow(broadcastId: string, commandId: string): Promise<Record<string, unknown>>;
  validate(
    broadcastId: string,
    commandId: string,
    confirmedTestObservationId: string
  ): Promise<Record<string, unknown>>;
}

function boundedCount(value: unknown) {
  return Math.max(0, Math.min(10_000_000, Number(value) || 0));
}

function boundedInventory(value: unknown): NewsletterProviderInventoryStatus {
  const source = record(value);
  const sourceCounts = record(source.counts);
  const mode = source.mode === "initial" || source.mode === "steady"
    ? source.mode
    : "disabled_setup";
  return {
    state: source.state === "ready" ? "ready" : "blocked",
    activationReady: source.activationReady === true,
    mode,
    policyVersion: text(source.policyVersion).slice(0, 80),
    categories: Array.isArray(source.categories)
      ? source.categories.slice(0, 32).map((value) => {
          const item = record(value);
          return {
            category: text(item.category).slice(0, 80),
            status: item.status === "ready" ? "ready" as const : "blocked" as const,
            code: text(item.code).slice(0, 100),
            count: boundedCount(item.count)
          };
        })
      : [],
    counts: {
      contacts: boundedCount(sourceCounts.contacts),
      segmentContacts: boundedCount(sourceCounts.segmentContacts),
      suppressions: boundedCount(sourceCounts.suppressions),
      broadcasts: boundedCount(sourceCounts.broadcasts),
      sentBroadcasts: boundedCount(sourceCounts.sentBroadcasts),
      emails: boundedCount(sourceCounts.emails),
      localEligible: boundedCount(sourceCounts.localEligible)
    }
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Newsletter operations are unavailable.");
  return value as Record<string, unknown>;
}

function text(value: unknown, alternate?: unknown): string {
  const candidate = typeof value === "string" ? value : alternate;
  return typeof candidate === "string" ? candidate : "";
}

function boundedStatus(value: unknown): NewsletterOperationsStatus {
  const source = record(value);
  const confirmed = source.confirmedTest ? record(source.confirmedTest) : null;
  const validation = source.validation ? record(source.validation) : null;
  const activation = source.providerActivation ? record(source.providerActivation) : {};
  const attestation = source.providerAttestation ? record(source.providerAttestation) : {};
  const authSmtpProofs = source.authSmtpProofs ? record(source.authSmtpProofs) : {};
  const circuit = source.reconciliationCircuit ? record(source.reconciliationCircuit) : {};
  return {
    version: 1,
    queuedJobs: Math.max(0, Math.min(10_000, Number(source.queuedJobs) || 0)),
    openIncidents: Math.max(0, Math.min(10_000, Number(source.openIncidents) || 0)),
    providerActivation: {
      active: activation.active === true,
      recordedAt: text(activation.recordedAt, activation.recorded_at).slice(0, 40)
    },
    providerAttestation: {
      current: attestation.current === true,
      expiresAt: text(attestation.expiresAt, attestation.expires_at).slice(0, 40)
    },
    authSmtpProofs: {
      replacementLogin: authSmtpProofs.replacementLogin === true,
      postRevocationLogin: authSmtpProofs.postRevocationLogin === true
    },
    reconciliationCircuit: {
      state: circuit.state === "open" ? "open" : "closed",
      code: text(circuit.code, circuit.safe_failure_code).slice(0, 64)
    },
    confirmedTest: confirmed ? {
      id: text(confirmed.id).slice(0, 100),
      providerBroadcastId: text(confirmed.providerBroadcastId, confirmed.provider_broadcast_id).slice(0, 200),
      digest: text(confirmed.digest).slice(0, 64),
      confirmedAt: text(confirmed.confirmedAt, confirmed.confirmed_at).slice(0, 40)
    } : null,
    validation: validation ? {
      id: text(validation.id).slice(0, 100),
      providerBroadcastId: text(validation.providerBroadcastId, validation.provider_broadcast_id).slice(0, 200),
      digest: text(validation.digest).slice(0, 64),
      audienceCount: Math.max(0, Math.min(10_000_000, Number(validation.audienceCount ?? validation.audience_count) || 0)),
      validatedAt: text(validation.validatedAt, validation.validated_at).slice(0, 40),
      validUntil: text(validation.validUntil, validation.valid_until).slice(0, 40),
      state: text(validation.state).slice(0, 30),
      readinessRevisionId: text(validation.readinessRevisionId, validation.readiness_revision_id).slice(0, 100)
    } : null
  };
}

async function responseJson(response: Response) {
  if (!response.ok) throw new Error("Newsletter operations are unavailable.");
  return record(await response.json());
}

export function createNewsletterOperationsClient(
  getCsrfToken: () => string | null
): NewsletterOperationsClient {
  const pendingCommands = new Map<string, string>();
  async function mutation(path: string, body: Record<string, unknown>) {
    const csrf = getCsrfToken();
    if (!csrf) throw new Error("The editor session must be refreshed.");
    return responseJson(await fetch(`/api/newsletter/operations/${path}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-builder-csrf": csrf },
      body: JSON.stringify(body)
    }));
  }
  async function commandMutation(
    path: string,
    broadcastId: string,
    proposedCommandId: string,
    body: Record<string, unknown> = {}
  ) {
    const key = `${path}:${broadcastId}`;
    const commandId = pendingCommands.get(key) ?? proposedCommandId;
    const result = await mutation(path, { ...body, broadcastId, commandId });
    if (result.state === "pending") pendingCommands.set(key, commandId);
    else pendingCommands.delete(key);
    return result;
  }
  return {
    async status() {
      return boundedStatus(await responseJson(await fetch("/api/newsletter/operations/status", {
        credentials: "same-origin",
        cache: "no-store"
      })));
    },
    async providerInventory() {
      const response = await fetch("/api/newsletter/operations/provider-inventory", {
        credentials: "same-origin",
        cache: "no-store"
      });
      if (!response.ok && response.status !== 409) {
        throw new Error("Newsletter provider inventory is unavailable.");
      }
      return boundedInventory(await response.json());
    },
    recordProviderAttestation: (commandId) => mutation(
      "provider-attestation", { commandId, confirmed: true }
    ),
    recordAuthSmtpProof: (commandId, phase) => mutation(
      "auth-smtp-proof", { commandId, phase }
    ),
    activateProvider: (commandId) => mutation("provider-activation", { commandId }),
    recoverReconciliation: (commandId, reason) => mutation(
      "recovery", { commandId, reason }
    ),
    activationCheck: (broadcastId) => commandMutation(
      "activation-check", broadcastId, crypto.randomUUID()
    ),
    openStaffTestWindow: (broadcastId, commandId) => commandMutation(
      "staff-test", broadcastId, commandId
    ),
    validate: (broadcastId, commandId, confirmedTestObservationId) => commandMutation(
      "validate", broadcastId, commandId, { confirmedTestObservationId }
    )
  };
}
