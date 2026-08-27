import "server-only";

import { createHash } from "node:crypto";

import type { NewsletterProviderInventoryConfigurationState } from "./types";

export const NEWSLETTER_INVENTORY_POLICY_VERSION =
  "resend-district-newsletter-v1" as const;

export const REQUIRED_NEWSLETTER_WEBHOOK_EVENTS = [
  "contact.created",
  "contact.deleted",
  "contact.updated",
  "email.bounced",
  "email.complained",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.sent",
  "email.suppressed",
  "suppression.added",
  "suppression.removed"
] as const;

const NEWSLETTER_DOMAIN = "updates.assemblywomanmorales.com";
const NEWSLETTER_RESOURCE_NAME = "District Newsletter";
const NEWSLETTER_SENDER =
  "Office of Assemblywoman Carmen Morales <newsletter@updates.assemblywomanmorales.com>";
export const REQUIRED_NEWSLETTER_API_KEY_NAMES = [
  "Official Assembly Newsletter Send",
  "Official Assembly Newsletter Management",
  "Supabase Auth SMTP"
] as const;

export type NewsletterInventoryStage = "disabled_setup" | "initial" | "steady";

export type NewsletterProviderInventorySnapshot = {
  readonly managementCredentialReadable: boolean;
  readonly sendCredentialManagementRestricted: boolean;
  readonly domains: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: string;
  }[];
  readonly segments: readonly { readonly id: string; readonly name: string }[];
  readonly topics: readonly {
    readonly id: string;
    readonly name: string;
    readonly defaultSubscription: string;
    readonly visibility: string;
  }[];
  readonly webhooks: readonly {
    readonly id: string;
    readonly endpoint: string;
    readonly status: string;
    readonly events: readonly string[];
  }[];
  readonly apiKeys: readonly { readonly id: string; readonly name: string }[];
  readonly contacts: readonly { readonly id: string; readonly email: string }[];
  readonly segmentContacts: readonly { readonly id: string; readonly email: string }[];
  readonly suppressions: readonly {
    readonly id: string;
    readonly email: string;
    readonly origin: string;
  }[];
  readonly broadcasts: readonly {
    readonly id: string;
    readonly status: "draft" | "queued" | "sent";
    readonly from: string;
    readonly segmentId: string;
    readonly topicId: string;
  }[];
  readonly emails: readonly {
    readonly id: string;
    readonly status: string;
    readonly createdAt: string;
    readonly from: string;
    readonly to: readonly string[];
    readonly subject: string;
  }[];
  readonly imports: readonly { readonly id: string }[];
  readonly templates: readonly { readonly id: string }[];
  readonly automations: readonly { readonly id: string }[];
  readonly oauthGrants: readonly { readonly id: string }[];
  readonly contactProperties: readonly { readonly id: string }[];
  readonly customEvents: readonly { readonly id: string }[];
  readonly receivedEmails: readonly { readonly id: string }[];
};

export type NewsletterProviderInventoryEvidence = {
  readonly providerContactIds: ReadonlySet<string>;
  readonly retainedContactEmails: ReadonlySet<string>;
  readonly suppressionEmails: ReadonlySet<string>;
  readonly allowedProviderMessageIds: ReadonlySet<string>;
  readonly allowedSentBroadcastIds: ReadonlySet<string>;
  readonly localEligibleCount: number;
  readonly manualAttestationCurrent: boolean;
  readonly authSmtpPermissionAttested: boolean;
  readonly authSmtpLoginBeforeRevocationProved: boolean;
  readonly authSmtpLoginAfterRevocationProved: boolean;
  readonly ownerLoginEvidenceValid: boolean;
};

export type NewsletterInventoryCategory =
  | "credential_access"
  | "domains"
  | "segments"
  | "topics"
  | "webhooks"
  | "api_keys"
  | "contacts"
  | "suppressions"
  | "broadcast_drafts"
  | "broadcast_queue"
  | "sent_broadcasts"
  | "transactional_emails"
  | "imports"
  | "templates"
  | "automations"
  | "oauth_grants"
  | "contact_properties"
  | "custom_events"
  | "received_emails"
  | "manual_attestation"
  | "auth_smtp"
  | "initial_boundary";

export type NewsletterInventoryCategoryResult = {
  readonly category: NewsletterInventoryCategory;
  readonly status: "ready" | "blocked";
  readonly code: string;
  readonly count: number;
};

export type NewsletterProviderInventoryResult = {
  readonly state: "ready" | "blocked";
  readonly activationReady: boolean;
  readonly mode: NewsletterInventoryStage;
  readonly policyVersion: typeof NEWSLETTER_INVENTORY_POLICY_VERSION;
  readonly resourceIdentityDigest: string;
  readonly categories: readonly NewsletterInventoryCategoryResult[];
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

export function disabledNewsletterInventoryCanEnterInitialActivation(
  result: NewsletterProviderInventoryResult
) {
  return result.mode === "disabled_setup" && result.categories.some((category) =>
    category.category === "api_keys" &&
    category.status === "ready" &&
    category.code === "policy_satisfied"
  );
}

export class NewsletterProviderIdentityChangedError extends Error {
  constructor() {
    super("provider_identity_changed");
    this.name = "NewsletterProviderIdentityChangedError";
  }
}

export function resolveNewsletterInventoryActivationStage(
  activeResourceIdentityDigest: string | null,
  currentResourceIdentityDigest: string
): "initial" | "steady" {
  if (!activeResourceIdentityDigest) return "initial";
  if (activeResourceIdentityDigest === currentResourceIdentityDigest) return "steady";
  throw new NewsletterProviderIdentityChangedError();
}

type ReadyInventoryConfiguration = Extract<
  NewsletterProviderInventoryConfigurationState,
  { status: "ready" }
>;

function category(
  name: NewsletterInventoryCategory,
  ready: boolean,
  count: number,
  failureCode: string,
  readyCode = "policy_satisfied"
): NewsletterInventoryCategoryResult {
  return {
    category: name,
    status: ready ? "ready" : "blocked",
    code: ready ? readyCode : failureCode,
    count
  };
}

function exactStrings(actual: readonly string[], expected: readonly string[]) {
  return [...actual].sort().join("\n") === [...expected].sort().join("\n");
}

function canonicalResourceIdentity(
  configuration: ReadyInventoryConfiguration,
  snapshot: NewsletterProviderInventorySnapshot
) {
  return JSON.stringify({
    policyVersion: NEWSLETTER_INVENTORY_POLICY_VERSION,
    canonicalSiteUrl: configuration.canonicalSiteUrl,
    domain: snapshot.domains.map((item) => [item.id, item.name, item.status]).sort(),
    segment: snapshot.segments.map((item) => [item.id, item.name]).sort(),
    topic: snapshot.topics
      .map((item) => [item.id, item.name, item.defaultSubscription, item.visibility])
      .sort(),
    webhook: snapshot.webhooks
      .map((item) => [item.id, item.endpoint, item.status, [...item.events].sort()])
      .sort(),
    apiKeys: snapshot.apiKeys.map((item) => [item.id, item.name]).sort()
  });
}

function normalizedEmails(values: ReadonlySet<string>) {
  return new Set([...values].map((value) => value.trim().toLowerCase()));
}

const AUTH_SMTP_DELIVERY_STATES = new Set(["sent", "delivered", "opened", "clicked"]);

function mailbox(value: string) {
  const trimmed = value.trim().toLowerCase();
  const bracketed = trimmed.match(/<([^<>]+)>$/)?.[1];
  return (bracketed ?? trimmed).trim();
}

export function findRecentNewsletterAuthSmtpLoginEmail(
  snapshot: NewsletterProviderInventorySnapshot,
  input: {
    readonly email: string;
    readonly lastSignInAt: Date;
    readonly excludedProviderMessageIds: ReadonlySet<string>;
  }
) {
  const ownerEmail = input.email.trim().toLowerCase();
  const signedInAt = input.lastSignInAt.getTime();
  if (!ownerEmail || !Number.isFinite(signedInAt)) return null;

  return snapshot.emails
    .filter((message) => {
      const createdAt = Date.parse(message.createdAt);
      const sender = mailbox(message.from);
      return Boolean(message.subject.trim()) &&
        AUTH_SMTP_DELIVERY_STATES.has(message.status) &&
        sender.endsWith(`@${NEWSLETTER_DOMAIN}`) &&
        message.to.some((recipient) => recipient.trim().toLowerCase() === ownerEmail) &&
        !input.excludedProviderMessageIds.has(message.id) &&
        Number.isFinite(createdAt) &&
        createdAt <= signedInAt &&
        signedInAt - createdAt <= 60 * 60 * 1_000;
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null;
}

export function evaluateNewsletterProviderInventory(input: {
  readonly stage: NewsletterInventoryStage;
  readonly configuration: ReadyInventoryConfiguration;
  readonly snapshot: NewsletterProviderInventorySnapshot;
  readonly evidence: NewsletterProviderInventoryEvidence;
}): NewsletterProviderInventoryResult {
  const { stage, configuration, snapshot, evidence } = input;
  const retainedEmails = normalizedEmails(evidence.retainedContactEmails);
  const suppressionEmails = normalizedEmails(evidence.suppressionEmails);
  const sentBroadcasts = snapshot.broadcasts.filter((item) => item.status === "sent");
  const queuedBroadcasts = snapshot.broadcasts.filter((item) => item.status === "queued");
  const draftBroadcasts = snapshot.broadcasts.filter((item) => item.status === "draft");

  const domainReady =
    snapshot.domains.length === 1 &&
    snapshot.domains[0]?.name === NEWSLETTER_DOMAIN &&
    snapshot.domains[0]?.status === "verified";
  const configuredSegments = snapshot.segments.filter((segment) =>
    segment.id === configuration.segmentId && segment.name === NEWSLETTER_RESOURCE_NAME
  );
  const additionalSegments = snapshot.segments.filter((segment) =>
    segment.id !== configuration.segmentId || segment.name !== NEWSLETTER_RESOURCE_NAME
  );
  const segmentReady =
    configuredSegments.length === 1 &&
    additionalSegments.length <= 1 &&
    additionalSegments.every((segment) => segment.name === "General");
  const topicReady =
    snapshot.topics.length === 1 &&
    snapshot.topics[0]?.id === configuration.topicId &&
    snapshot.topics[0]?.name === NEWSLETTER_RESOURCE_NAME &&
    snapshot.topics[0]?.defaultSubscription === "opt_out" &&
    snapshot.topics[0]?.visibility === "public";
  const webhookReady =
    snapshot.webhooks.length === 1 &&
    snapshot.webhooks[0]?.endpoint === configuration.webhookUrl &&
    snapshot.webhooks[0]?.status === "enabled" &&
    exactStrings(snapshot.webhooks[0]?.events ?? [], REQUIRED_NEWSLETTER_WEBHOOK_EVENTS);

  const configuredKeys = snapshot.apiKeys.filter((key) =>
    REQUIRED_NEWSLETTER_API_KEY_NAMES.includes(
      key.name as (typeof REQUIRED_NEWSLETTER_API_KEY_NAMES)[number]
    )
  );
  const configuredKeysPresent =
    configuredKeys.length === REQUIRED_NEWSLETTER_API_KEY_NAMES.length &&
    new Set(configuredKeys.map((key) => key.id)).size === configuredKeys.length &&
    REQUIRED_NEWSLETTER_API_KEY_NAMES.every((name) =>
      configuredKeys.filter((key) => key.name === name).length === 1
    );
  const extraKeys = snapshot.apiKeys.filter((key) =>
    !REQUIRED_NEWSLETTER_API_KEY_NAMES.includes(
      key.name as (typeof REQUIRED_NEWSLETTER_API_KEY_NAMES)[number]
    )
  );
  const legacyMigrationAllowed =
    stage === "disabled_setup" &&
    extraKeys.length === 1 &&
    extraKeys[0]?.name.trim().toLowerCase() === "onboarding";
  const keysReady =
    configuredKeysPresent && (extraKeys.length === 0 || legacyMigrationAllowed);

  const contactsReady = snapshot.contacts.every((contact) =>
    evidence.providerContactIds.has(contact.id) ||
    retainedEmails.has(contact.email.trim().toLowerCase())
  );
  const suppressionsReady = snapshot.suppressions.every((suppression) =>
    suppressionEmails.has(suppression.email.trim().toLowerCase())
  );
  const draftsReady = draftBroadcasts.every((broadcast) =>
    broadcast.from === NEWSLETTER_SENDER &&
    broadcast.segmentId === configuration.segmentId &&
    broadcast.topicId === configuration.topicId
  );
  const sentReady = sentBroadcasts.every((broadcast) =>
    evidence.allowedSentBroadcastIds.has(broadcast.id)
  );
  const emailsReady = evidence.ownerLoginEvidenceValid && snapshot.emails.every((email) =>
    evidence.allowedProviderMessageIds.has(email.id)
  );
  const authSmtpReady =
    evidence.authSmtpPermissionAttested &&
    evidence.authSmtpLoginBeforeRevocationProved &&
    evidence.authSmtpLoginAfterRevocationProved;
  const initialBoundaryReady =
    stage !== "initial" ||
    (snapshot.segmentContacts.length === 0 &&
      evidence.localEligibleCount === 0 &&
      sentBroadcasts.length === 0);

  const categories: NewsletterInventoryCategoryResult[] = [
    category(
      "credential_access",
      snapshot.managementCredentialReadable && snapshot.sendCredentialManagementRestricted,
      2,
      "credential_scope_unproved"
    ),
    category("domains", domainReady, snapshot.domains.length, "domain_policy_mismatch"),
    category("segments", segmentReady, snapshot.segments.length, "segment_policy_mismatch"),
    category("topics", topicReady, snapshot.topics.length, "topic_policy_mismatch"),
    category("webhooks", webhookReady, snapshot.webhooks.length, "webhook_policy_mismatch"),
    category(
      "api_keys",
      keysReady,
      snapshot.apiKeys.length,
      "api_key_policy_mismatch",
      legacyMigrationAllowed ? "legacy_migration_allowed" : "policy_satisfied"
    ),
    category("contacts", contactsReady, snapshot.contacts.length, "unmapped_contacts"),
    category(
      "suppressions",
      suppressionsReady,
      snapshot.suppressions.length,
      "unmapped_suppressions"
    ),
    category("broadcast_drafts", draftsReady, draftBroadcasts.length, "draft_boundary_mismatch"),
    category(
      "broadcast_queue",
      queuedBroadcasts.length === 0,
      queuedBroadcasts.length,
      "queued_broadcasts_present"
    ),
    category("sent_broadcasts", sentReady, sentBroadcasts.length, "unmapped_sent_broadcasts"),
    category(
      "transactional_emails",
      emailsReady,
      snapshot.emails.length,
      "unmapped_email_history"
    ),
    category("imports", snapshot.imports.length === 0, snapshot.imports.length, "unexpected_resources"),
    category("templates", snapshot.templates.length === 0, snapshot.templates.length, "unexpected_resources"),
    category("automations", snapshot.automations.length === 0, snapshot.automations.length, "unexpected_resources"),
    category("oauth_grants", snapshot.oauthGrants.length === 0, snapshot.oauthGrants.length, "unexpected_resources"),
    category("contact_properties", snapshot.contactProperties.length === 0, snapshot.contactProperties.length, "unexpected_resources"),
    category("custom_events", snapshot.customEvents.length === 0, snapshot.customEvents.length, "unexpected_resources"),
    category("received_emails", snapshot.receivedEmails.length === 0, snapshot.receivedEmails.length, "unexpected_resources"),
    category(
      "manual_attestation",
      evidence.manualAttestationCurrent,
      evidence.manualAttestationCurrent ? 1 : 0,
      "manual_attestation_missing"
    ),
    category("auth_smtp", authSmtpReady, authSmtpReady ? 3 : 0, "auth_smtp_proof_missing"),
    category(
      "initial_boundary",
      initialBoundaryReady,
      snapshot.segmentContacts.length,
      "initial_inventory_not_empty"
    )
  ];

  const state = categories.every((item) => item.status === "ready")
    ? "ready" as const
    : "blocked" as const;
  const resourceIdentityDigest = createHash("sha256")
    .update(canonicalResourceIdentity(configuration, snapshot), "utf8")
    .digest("hex");

  return {
    state,
    activationReady: stage !== "disabled_setup" && state === "ready",
    mode: stage,
    policyVersion: NEWSLETTER_INVENTORY_POLICY_VERSION,
    resourceIdentityDigest,
    categories,
    counts: {
      contacts: snapshot.contacts.length,
      segmentContacts: snapshot.segmentContacts.length,
      suppressions: snapshot.suppressions.length,
      broadcasts: snapshot.broadcasts.length,
      sentBroadcasts: sentBroadcasts.length,
      emails: snapshot.emails.length,
      localEligible: evidence.localEligibleCount
    }
  };
}
