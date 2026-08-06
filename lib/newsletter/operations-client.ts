"use client";

export type NewsletterOperationsStatus = {
  readonly version: 1;
  readonly queuedJobs: number;
  readonly openIncidents: number;
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

export interface NewsletterOperationsClient {
  status(): Promise<NewsletterOperationsStatus>;
  activationCheck(broadcastId: string): Promise<Record<string, unknown>>;
  openStaffTestWindow(broadcastId: string, commandId: string): Promise<Record<string, unknown>>;
  validate(
    broadcastId: string,
    commandId: string,
    confirmedTestObservationId: string
  ): Promise<Record<string, unknown>>;
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
  return {
    version: 1,
    queuedJobs: Math.max(0, Math.min(10_000, Number(source.queuedJobs) || 0)),
    openIncidents: Math.max(0, Math.min(10_000, Number(source.openIncidents) || 0)),
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
  return {
    async status() {
      return boundedStatus(await responseJson(await fetch("/api/newsletter/operations/status", {
        credentials: "same-origin",
        cache: "no-store"
      })));
    },
    activationCheck: (broadcastId) => mutation("activation-check", { broadcastId }),
    openStaffTestWindow: (broadcastId, commandId) => mutation("staff-test", { broadcastId, commandId }),
    validate: (broadcastId, commandId, confirmedTestObservationId) => mutation("validate", {
      broadcastId, commandId, confirmedTestObservationId
    })
  };
}
