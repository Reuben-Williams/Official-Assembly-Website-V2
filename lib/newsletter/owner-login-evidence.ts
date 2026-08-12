import "server-only";

import { createHash } from "node:crypto";

export const OWNER_LOGIN_POLICY_VERSION = "resend-owner-login-v1";
const OWNER_LOGIN_SUBJECT = "Your sign-in link";
const OWNER_LOGIN_SENDER = "no-reply@updates.assemblywomanmorales.com";
const OWNER_LOGIN_WINDOW_MS = 60 * 60 * 1_000;
const ALLOWED_OWNER_LOGIN_STATES = new Set(["sent", "delivered", "opened", "clicked"]);

function deterministicUuid(value: string) {
  const bytes = createHash("sha1").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

export type NewsletterOwnerLoginEmail = {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
};

export type NewsletterOwnerLoginEmailReader = {
  readonly listEmails: (input: {
    readonly limit: 100;
    readonly after?: string;
  }) => Promise<{
    readonly items: readonly NewsletterOwnerLoginEmail[];
    readonly hasMore: boolean;
    readonly after?: string;
  }>;
};

export function createNewsletterAuthLoginCommandId(_input: {
  readonly siteId: string;
  readonly operatorId: string;
  readonly occurredAt: string;
}) {
  const input = _input;
  return deterministicUuid(JSON.stringify({
    policyVersion: OWNER_LOGIN_POLICY_VERSION,
    siteId: input.siteId,
    operatorId: input.operatorId,
    occurredAt: new Date(input.occurredAt).toISOString()
  }));
}

export function createNewsletterAuthLoginEvidenceCommandId(input: {
  readonly siteId: string;
  readonly occurrenceId: string;
  readonly providerMessageId: string;
}) {
  return deterministicUuid(JSON.stringify({
    policyVersion: OWNER_LOGIN_POLICY_VERSION,
    operation: "record-evidence",
    siteId: input.siteId,
    occurrenceId: input.occurrenceId,
    providerMessageId: input.providerMessageId
  }));
}

export function createNewsletterAuthLoginEvidenceDigest(_input: {
  readonly siteId: string;
  readonly operatorId: string;
  readonly occurrenceId: string;
  readonly providerMessageId: string;
  readonly providerCreatedAt: string;
  readonly authLastSignInAt: string;
}) {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    policyVersion: OWNER_LOGIN_POLICY_VERSION,
    siteId: _input.siteId,
    operatorId: _input.operatorId,
    occurrenceId: _input.occurrenceId,
    providerMessageId: _input.providerMessageId,
    providerCreatedAt: new Date(_input.providerCreatedAt).toISOString(),
    authLastSignInAt: new Date(_input.authLastSignInAt).toISOString()
  }), "utf8").digest("hex");
}

function mailbox(value: string) {
  const normalized = value.trim().toLowerCase();
  return (normalized.match(/<([^<>]+)>$/)?.[1] ?? normalized).trim();
}

export function selectNewsletterOwnerLoginMessage(
  _emails: readonly NewsletterOwnerLoginEmail[],
  _input: {
    readonly ownerEmail: string;
    readonly occurredAt: string;
    readonly excludedProviderMessageIds: ReadonlySet<string>;
  }
): NewsletterOwnerLoginEmail | null {
  const ownerEmail = _input.ownerEmail.trim().toLowerCase();
  const occurredAt = Date.parse(_input.occurredAt);
  if (!ownerEmail || !Number.isFinite(occurredAt)) return null;

  const candidates = _emails.filter((email) => {
    const createdAt = Date.parse(email.createdAt);
    const recipient = email.to.length === 1 ? email.to[0]!.trim().toLowerCase() : "";
    return Boolean(email.id) &&
      !_input.excludedProviderMessageIds.has(email.id) &&
      email.subject === OWNER_LOGIN_SUBJECT &&
      mailbox(email.from) === OWNER_LOGIN_SENDER &&
      recipient === ownerEmail &&
      ALLOWED_OWNER_LOGIN_STATES.has(email.status) &&
      Number.isFinite(createdAt) &&
      createdAt <= occurredAt &&
      occurredAt - createdAt <= OWNER_LOGIN_WINDOW_MS;
  });
  return candidates.length === 1 ? candidates[0]! : null;
}

export async function collectNewsletterOwnerLoginEmails(
  _reader: NewsletterOwnerLoginEmailReader,
  _input: {
    readonly occurredAt: Date;
    readonly maximumPages?: number;
    readonly maximumDurationMs?: number;
    readonly now?: () => number;
  }
): Promise<NewsletterOwnerLoginEmail[]> {
  const maximumPages = _input.maximumPages ?? 20;
  const maximumDurationMs = _input.maximumDurationMs ?? 5_000;
  const now = _input.now ?? Date.now;
  const occurredAt = _input.occurredAt.getTime();
  if (!Number.isFinite(occurredAt) || !Number.isInteger(maximumPages) || maximumPages < 1 ||
    maximumPages > 20 || !Number.isFinite(maximumDurationMs) || maximumDurationMs < 1 ||
    maximumDurationMs > 5_000) {
    throw new Error("owner_login_email_inventory_unavailable");
  }

  const startedAt = now();
  const windowStart = occurredAt - OWNER_LOGIN_WINDOW_MS;
  const emails: NewsletterOwnerLoginEmail[] = [];
  const cursors = new Set<string>();
  let after: string | undefined;

  for (let pageNumber = 1; pageNumber <= maximumPages; pageNumber += 1) {
    if (now() - startedAt > maximumDurationMs) {
      throw new Error("owner_login_email_inventory_unavailable");
    }
    const page = await _reader.listEmails({ limit: 100, after });
    if (now() - startedAt > maximumDurationMs) {
      throw new Error("owner_login_email_inventory_unavailable");
    }

    let crossedBoundary = false;
    for (const email of page.items) {
      const createdAt = Date.parse(email.createdAt);
      if (!Number.isFinite(createdAt)) {
        throw new Error("owner_login_email_inventory_unavailable");
      }
      if (createdAt < windowStart) {
        crossedBoundary = true;
        continue;
      }
      emails.push(email);
    }
    if (crossedBoundary || !page.hasMore) return emails;
    if (!page.after || page.after === after || cursors.has(page.after)) {
      throw new Error("owner_login_email_inventory_unavailable");
    }
    cursors.add(page.after);
    after = page.after;
  }

  throw new Error("owner_login_email_inventory_unavailable");
}
