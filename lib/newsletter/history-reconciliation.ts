import { createHash } from "node:crypto";

import type { NewsletterProviderInventorySnapshot } from "./provider-inventory";

export const NEWSLETTER_HISTORY_RECONCILIATION_POLICY_VERSION =
  "resend-initial-history-v2" as const;

export const APPROVED_NEWSLETTER_HISTORY_AUTH_MESSAGE_IDS = [
  "811ea57a-349d-40c5-a0e6-880b2c79eff4",
  "a1c81a5d-c005-48b3-8ab0-3894958ac9cf",
  "d7477a6b-e5ff-4dac-a087-2a162567b538",
  "a9f2632a-63f3-403d-9cc3-b727173df3df",
  "1c9faeab-9011-40df-a011-fe7203dd3f29",
  "21b1a46d-625b-4338-bdd7-dbb4bdca953d",
  "8f77edd1-1342-48a7-99a5-4d0ce8eebbff",
  "294b5df4-7128-40a6-ab5b-ea719a74c953"
] as const;

const APPROVED_NEWSLETTER_HISTORY_PROOF_MESSAGE_IDS = [
  "6d01e63a-4fea-471c-937e-4d869a3760d1",
  "8c2096bb-0eaf-4e72-a899-6afdff68b7aa"
] as const;

export const APPROVED_NEWSLETTER_HISTORY_FAILED_MESSAGE_ID =
  "038fb647-8443-42d1-9c16-98f45d944d34" as const;

const APPROVED_HISTORY_IDS = new Set([
  ...APPROVED_NEWSLETTER_HISTORY_AUTH_MESSAGE_IDS,
  ...APPROVED_NEWSLETTER_HISTORY_PROOF_MESSAGE_IDS,
  APPROVED_NEWSLETTER_HISTORY_FAILED_MESSAGE_ID
]);

export type NewsletterHistoryReconciliationClassification =
  | "auth_smtp_magic_link"
  | "unattributed_failed_setup_test";

export type NewsletterHistoryReconciliationEntry = {
  readonly providerMessageId: string;
  readonly classification: NewsletterHistoryReconciliationClassification;
  readonly providerStatus: "delivered" | "failed";
  readonly providerCreatedAt: string;
};

export type NewsletterHistoryReceiptEvidence = {
  readonly providerMessageId: string;
  readonly eventType: string;
  readonly providerBroadcastId: string;
  readonly disposition: string;
};

export type NewsletterHistoryReconciliationErrorCode =
  | "unexpected_provider_history"
  | "unverified_auth_history"
  | "invalid_failed_setup_history";

export class NewsletterHistoryReconciliationError extends Error {
  constructor(readonly code: NewsletterHistoryReconciliationErrorCode) {
    super("The provider history does not match the approved reconciliation boundary.");
    this.name = "NewsletterHistoryReconciliationError";
  }
}

function mailbox(value: string) {
  const normalized = value.trim().toLowerCase();
  return (normalized.match(/<([^<>]+)>$/)?.[1] ?? normalized).trim();
}

function exactSet(actual: ReadonlySet<string>, expected: ReadonlySet<string>) {
  return actual.size === expected.size && [...actual].every((value) => expected.has(value));
}

export function planNewsletterHistoryReconciliation(input: {
  readonly ownerEmail: string;
  readonly emails: NewsletterProviderInventorySnapshot["emails"];
  readonly receipts: readonly NewsletterHistoryReceiptEvidence[];
  readonly existingAuthProofIds: ReadonlySet<string>;
}) {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const emailIds = new Set(input.emails.map((email) => email.id));
  const proofIds = new Set(APPROVED_NEWSLETTER_HISTORY_PROOF_MESSAGE_IDS);
  if (!ownerEmail || emailIds.size !== input.emails.length
    || !exactSet(emailIds, APPROVED_HISTORY_IDS)
    || !exactSet(input.existingAuthProofIds, proofIds)) {
    throw new NewsletterHistoryReconciliationError("unexpected_provider_history");
  }

  const byId = new Map(input.emails.map((email) => [email.id, email]));
  const allAuthIds = [
    ...APPROVED_NEWSLETTER_HISTORY_AUTH_MESSAGE_IDS,
    ...APPROVED_NEWSLETTER_HISTORY_PROOF_MESSAGE_IDS
  ];
  for (const providerMessageId of allAuthIds) {
    const email = byId.get(providerMessageId);
    const receipts = input.receipts.filter((receipt) =>
      receipt.providerMessageId === providerMessageId
    );
    const eventTypes = new Set(receipts.map((receipt) => receipt.eventType));
    const verifiedReceipts = receipts.length === 2
      && receipts.every((receipt) => receipt.disposition === "matched"
        && !receipt.providerBroadcastId
        && (receipt.eventType === "email.sent" || receipt.eventType === "email.delivered"))
      && eventTypes.has("email.sent")
      && eventTypes.has("email.delivered");
    if (!email
      || email.status !== "delivered"
      || email.subject !== "Your sign-in link"
      || mailbox(email.from) !== "no-reply@updates.assemblywomanmorales.com"
      || !email.to.some((recipient) => recipient.trim().toLowerCase() === ownerEmail)
      || !Number.isFinite(Date.parse(email.createdAt))
      || !verifiedReceipts) {
      throw new NewsletterHistoryReconciliationError("unverified_auth_history");
    }
  }

  const failed = byId.get(APPROVED_NEWSLETTER_HISTORY_FAILED_MESSAGE_ID);
  if (!failed
    || failed.status !== "failed"
    || failed.subject !== "Hello World"
    || !failed.to.some((recipient) => recipient.trim().toLowerCase() === ownerEmail)
    || !Number.isFinite(Date.parse(failed.createdAt))
    || input.receipts.some((receipt) =>
      receipt.providerMessageId === APPROVED_NEWSLETTER_HISTORY_FAILED_MESSAGE_ID
    )) {
    throw new NewsletterHistoryReconciliationError("invalid_failed_setup_history");
  }

  const entries: NewsletterHistoryReconciliationEntry[] = [
    ...APPROVED_NEWSLETTER_HISTORY_AUTH_MESSAGE_IDS.map((providerMessageId) => {
      const email = byId.get(providerMessageId)!;
      return {
        providerMessageId,
        classification: "auth_smtp_magic_link" as const,
        providerStatus: "delivered" as const,
        providerCreatedAt: new Date(email.createdAt).toISOString()
      };
    }),
    {
      providerMessageId: APPROVED_NEWSLETTER_HISTORY_FAILED_MESSAGE_ID,
      classification: "unattributed_failed_setup_test",
      providerStatus: "failed",
      providerCreatedAt: new Date(failed.createdAt).toISOString()
    }
  ];

  return {
    state: "ready" as const,
    providerHistoryCount: input.emails.length,
    existingAuthProofCount: input.existingAuthProofIds.size,
    entries
  };
}

export function createNewsletterHistoryReconciliationDigest(input: {
  readonly siteId: string;
  readonly operatorId: string;
  readonly entries: readonly NewsletterHistoryReconciliationEntry[];
}) {
  return createHash("sha256").update(JSON.stringify({
    version: 2,
    policyVersion: NEWSLETTER_HISTORY_RECONCILIATION_POLICY_VERSION,
    siteId: input.siteId,
    operatorId: input.operatorId,
    entries: [...input.entries].sort((left, right) =>
      left.providerMessageId.localeCompare(right.providerMessageId)
    )
  }), "utf8").digest("hex");
}
