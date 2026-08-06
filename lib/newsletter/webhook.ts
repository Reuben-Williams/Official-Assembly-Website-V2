import "server-only";

import { createHash } from "node:crypto";

const MAX_BODY_BYTES = 64 * 1_024;
const REQUIRED_HEADERS = ["svix-id", "svix-timestamp", "svix-signature"] as const;

type Classification = {
  readonly disposition: "matched" | "incident";
  readonly providerBroadcastId?: string;
  readonly digest: string;
  readonly incidentReason?: "unvalidated" | "mismatch" | "expired" | "provider_anomaly";
  readonly providerStatus?: string;
  readonly sentAt?: string;
};

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function eventRecord(value: unknown): {
  readonly type: string;
  readonly createdAt: string;
  readonly data: Record<string, unknown>;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.type !== "string" || event.type.length > 100 ||
    typeof event.created_at !== "string" || !Number.isFinite(Date.parse(event.created_at)) ||
    !event.data || typeof event.data !== "object" || Array.isArray(event.data)
  ) return null;
  return { type: event.type, createdAt: event.created_at, data: event.data as Record<string, unknown> };
}

function relevant(type: string): boolean {
  return type.startsWith("email.") || type === "contact.updated" || type.startsWith("suppression.");
}

export async function handleResendNewsletterWebhook(
  request: Request,
  dependencies: {
    readonly siteId: string;
    readonly providerScopeId: string;
    readonly verify: (input: {
      readonly payload: string;
      readonly headers: { readonly id: string; readonly timestamp: string; readonly signature: string };
    }) => unknown;
    readonly classify: (input: {
      readonly svixId: string;
      readonly eventType: string;
      readonly providerCreatedAt: string;
      readonly providerMessageId?: string;
      readonly providerBroadcastId?: string;
    }) => Promise<Classification>;
    readonly reconcile: (input: {
      readonly siteId: string;
      readonly providerScopeId: string;
      readonly svixId: string;
      readonly eventType: string;
      readonly providerCreatedAt: string;
      readonly providerMessageId?: string;
      readonly providerBroadcastId?: string;
      readonly disposition: "ignored" | "matched" | "incident";
      readonly incidentReason?: "unvalidated" | "mismatch" | "expired" | "provider_anomaly";
      readonly providerStatus?: string;
      readonly sentAt?: string;
      readonly digest: string;
    }) => Promise<{ readonly disposition: "ignored" | "matched" | "incident"; readonly replayed: boolean }>;
  }
) {
  if (request.method !== "POST") return json(405, { status: "method_not_allowed" });
  const values = REQUIRED_HEADERS.map((name) => request.headers.get(name));
  if (values.some((value) => !value)) return json(400, { status: "invalid_webhook" });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json(413, { status: "invalid_webhook" });
  }
  let rawBody: string;
  let verified: unknown;
  try {
    rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) throw new Error("too large");
    verified = dependencies.verify({
      payload: rawBody,
      headers: { id: values[0]!, timestamp: values[1]!, signature: values[2]! }
    });
  } catch {
    return json(400, { status: "invalid_webhook" });
  }
  const event = eventRecord(verified);
  if (!event) return json(400, { status: "invalid_webhook" });
  const providerMessageId = typeof event.data.email_id === "string"
    ? event.data.email_id.slice(0, 200)
    : typeof event.data.id === "string"
      ? event.data.id.slice(0, 200)
      : undefined;
  const providerBroadcastId = typeof event.data.broadcast_id === "string"
    ? event.data.broadcast_id.slice(0, 200)
    : undefined;

  let classification: Classification | null = null;
  if (relevant(event.type)) {
    try {
      classification = await dependencies.classify({
        svixId: values[0]!,
        eventType: event.type,
        providerCreatedAt: event.createdAt,
        providerMessageId,
        providerBroadcastId
      });
    } catch {
      return json(503, { status: "retryable" });
    }
  }
  const disposition = classification?.disposition ?? "ignored";
  const digest = classification?.digest ?? createHash("sha256")
    .update(`${event.type}\n${values[0]}`, "utf8").digest("hex");
  try {
    const result = await dependencies.reconcile({
      siteId: dependencies.siteId,
      providerScopeId: dependencies.providerScopeId,
      svixId: values[0]!,
      eventType: event.type,
      providerCreatedAt: event.createdAt,
      providerMessageId,
      providerBroadcastId: classification?.providerBroadcastId ?? providerBroadcastId,
      disposition,
      incidentReason: classification?.incidentReason,
      providerStatus: classification?.providerStatus,
      sentAt: classification?.sentAt,
      digest
    });
    return json(200, { status: "accepted", disposition: result.disposition, replayed: result.replayed });
  } catch {
    return json(503, { status: "retryable" });
  }
}
