import { describe, expect, it } from "vitest";

import {
  evaluateNewsletterProviderInventory,
  findRecentNewsletterAuthSmtpLoginEmail,
  NEWSLETTER_INVENTORY_POLICY_VERSION,
  REQUIRED_NEWSLETTER_WEBHOOK_EVENTS,
  resolveNewsletterInventoryActivationStage,
  type NewsletterProviderInventoryEvidence,
  type NewsletterProviderInventorySnapshot
} from "../lib/newsletter/provider-inventory";
import {
  collectNewsletterProviderInventory,
  type NewsletterProviderInventoryReader
} from "../lib/newsletter/resend/inventory-adapter";

const configuration = {
  status: "ready" as const,
  environment: "production" as const,
  canonicalSiteUrl: "https://www.assemblywomanmorales.com",
  segmentId: "78261eea-8f8b-4381-83c6-79fa7120f1cf",
  topicId: "b134d33a-4d91-4b5f-a186-04e48cfe0048",
  sendKeyId: "key_newsletter_send",
  managementKeyId: "key_newsletter_management",
  authSmtpKeyId: "key_site_auth_smtp",
  webhookUrl: "https://www.assemblywomanmorales.com/api/webhooks/resend"
};

function snapshot(
  overrides: Partial<NewsletterProviderInventorySnapshot> = {}
): NewsletterProviderInventorySnapshot {
  return {
    managementCredentialReadable: true,
    sendCredentialManagementRestricted: true,
    domains: [{ id: "domain-1", name: "updates.assemblywomanmorales.com", status: "verified" }],
    segments: [{ id: configuration.segmentId, name: "District Newsletter" }],
    topics: [{
      id: configuration.topicId,
      name: "District Newsletter",
      defaultSubscription: "opt_out",
      visibility: "public"
    }],
    webhooks: [{
      id: "webhook-1",
      endpoint: configuration.webhookUrl,
      status: "enabled",
      events: REQUIRED_NEWSLETTER_WEBHOOK_EVENTS
    }],
    apiKeys: [
      { id: configuration.sendKeyId, name: "Newsletter Send" },
      { id: configuration.managementKeyId, name: "Newsletter Management" },
      { id: configuration.authSmtpKeyId, name: "Site Auth SMTP" }
    ],
    contacts: [],
    segmentContacts: [],
    suppressions: [],
    broadcasts: [],
    emails: [],
    imports: [],
    templates: [],
    automations: [],
    oauthGrants: [],
    contactProperties: [],
    customEvents: [],
    receivedEmails: [],
    ...overrides
  };
}

function evidence(
  overrides: Partial<NewsletterProviderInventoryEvidence> = {}
): NewsletterProviderInventoryEvidence {
  return {
    providerContactIds: new Set(),
    retainedContactEmails: new Set(),
    suppressionEmails: new Set(),
    allowedProviderMessageIds: new Set(),
    allowedSentBroadcastIds: new Set(),
    localEligibleCount: 0,
    manualAttestationCurrent: true,
    authSmtpPermissionAttested: true,
    authSmtpLoginBeforeRevocationProved: true,
    authSmtpLoginAfterRevocationProved: true,
    ...overrides
  };
}

describe("newsletter provider inventory policy", () => {
  it("matches only a recent delivered Auth email for the exact signed-in owner", () => {
    const signedInAt = new Date("2026-08-07T18:05:00.000Z");
    const matched = findRecentNewsletterAuthSmtpLoginEmail(snapshot({
      emails: [
        {
          id: "wrong-recipient",
          status: "delivered",
          createdAt: "2026-08-07T18:04:00.000Z",
          from: "Office <auth@updates.assemblywomanmorales.com>",
          to: ["other@example.com"],
          subject: "Sign in"
        },
        {
          id: "auth-message-1",
          status: "opened",
          createdAt: "2026-08-07T18:03:00.000Z",
          from: "Office <auth@updates.assemblywomanmorales.com>",
          to: ["OWNER@EXAMPLE.COM"],
          subject: "Your sign-in link"
        }
      ]
    }), {
      email: "owner@example.com",
      lastSignInAt: signedInAt,
      excludedProviderMessageIds: new Set()
    });

    expect(matched?.id).toBe("auth-message-1");
  });

  it("rejects failed, stale, wrong-domain, future, and previously used Auth messages", () => {
    const candidates: NewsletterProviderInventorySnapshot["emails"] = [
      {
        id: "failed",
        status: "failed",
        createdAt: "2026-08-07T18:04:00.000Z",
        from: "Office <auth@updates.assemblywomanmorales.com>",
        to: ["owner@example.com"],
        subject: "Sign in"
      },
      {
        id: "stale",
        status: "delivered",
        createdAt: "2026-08-07T16:00:00.000Z",
        from: "Office <auth@updates.assemblywomanmorales.com>",
        to: ["owner@example.com"],
        subject: "Sign in"
      },
      {
        id: "wrong-domain",
        status: "delivered",
        createdAt: "2026-08-07T18:04:00.000Z",
        from: "attacker@example.com",
        to: ["owner@example.com"],
        subject: "Sign in"
      },
      {
        id: "future",
        status: "delivered",
        createdAt: "2026-08-07T18:06:00.000Z",
        from: "Office <auth@updates.assemblywomanmorales.com>",
        to: ["owner@example.com"],
        subject: "Sign in"
      },
      {
        id: "already-used",
        status: "clicked",
        createdAt: "2026-08-07T18:04:30.000Z",
        from: "Office <auth@updates.assemblywomanmorales.com>",
        to: ["owner@example.com"],
        subject: "Sign in"
      }
    ];
    expect(findRecentNewsletterAuthSmtpLoginEmail(snapshot({ emails: candidates }), {
      email: "owner@example.com",
      lastSignInAt: new Date("2026-08-07T18:05:00.000Z"),
      excludedProviderMessageIds: new Set(["already-used"])
    })).toBeNull();
  });

  it("uses initial mode only before activation and fails on provider identity drift", () => {
    const digest = "a".repeat(64);
    expect(resolveNewsletterInventoryActivationStage(null, digest)).toBe("initial");
    expect(resolveNewsletterInventoryActivationStage(digest, digest)).toBe("steady");
    expect(() => resolveNewsletterInventoryActivationStage("b".repeat(64), digest))
      .toThrow("provider_identity_changed");
  });

  it("accepts the exact zero-audience initial inventory without exposing provider IDs", () => {
    const result = evaluateNewsletterProviderInventory({
      stage: "initial",
      configuration,
      snapshot: snapshot(),
      evidence: evidence()
    });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      state: "ready",
      activationReady: true,
      policyVersion: NEWSLETTER_INVENTORY_POLICY_VERSION,
      mode: "initial",
      counts: {
        contacts: 0,
        segmentContacts: 0,
        sentBroadcasts: 0,
        localEligible: 0
      }
    });
    expect(result.resourceIdentityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.categories.every((category) => category.status === "ready")).toBe(true);
    expect(serialized).not.toContain(configuration.segmentId);
    expect(serialized).not.toContain(configuration.topicId);
    expect(serialized).not.toContain(configuration.sendKeyId);
  });

  it("allows only the named legacy key during disabled migration and still marks activation blocked", () => {
    const result = evaluateNewsletterProviderInventory({
      stage: "disabled_setup",
      configuration,
      snapshot: snapshot({
        apiKeys: [...snapshot().apiKeys, { id: "legacy-key", name: "Onboarding" }]
      }),
      evidence: evidence({
        manualAttestationCurrent: false,
        authSmtpLoginAfterRevocationProved: false
      })
    });

    expect(result.state).toBe("blocked");
    expect(result.activationReady).toBe(false);
    expect(result.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "api_keys", status: "ready", code: "legacy_migration_allowed" }),
      expect.objectContaining({ category: "manual_attestation", status: "blocked" }),
      expect.objectContaining({ category: "auth_smtp", status: "blocked" })
    ]));
  });

  it("fails closed on unrelated resources, scheduled mail, and unmapped personal records", () => {
    const result = evaluateNewsletterProviderInventory({
      stage: "steady",
      configuration,
      snapshot: snapshot({
        contacts: [{ id: "contact-unmapped", email: "resident@example.com" }],
        segmentContacts: [{ id: "contact-unmapped", email: "resident@example.com" }],
        suppressions: [{ id: "suppression-unmapped", email: "resident@example.com", origin: "complaint" }],
        broadcasts: [{
          id: "broadcast-queued",
          status: "queued",
          from: "Office <newsletter@updates.assemblywomanmorales.com>",
          segmentId: configuration.segmentId,
          topicId: configuration.topicId
        }],
        emails: [{
          id: "email-unmapped",
          status: "scheduled",
          createdAt: "2026-08-07T18:00:00.000Z",
          from: "Office <newsletter@updates.assemblywomanmorales.com>",
          to: ["resident@example.com"],
          subject: "Scheduled email"
        }],
        imports: [{ id: "import-1" }],
        templates: [{ id: "template-1" }],
        automations: [{ id: "automation-1" }],
        oauthGrants: [{ id: "oauth-1" }],
        contactProperties: [{ id: "property-1" }],
        customEvents: [{ id: "event-1" }],
        receivedEmails: [{ id: "received-1" }]
      }),
      evidence: evidence()
    });
    const serialized = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "contacts", code: "unmapped_contacts" }),
      expect.objectContaining({ category: "suppressions", code: "unmapped_suppressions" }),
      expect.objectContaining({ category: "broadcast_queue", code: "queued_broadcasts_present" }),
      expect.objectContaining({ category: "transactional_emails", code: "unmapped_email_history" }),
      expect.objectContaining({ category: "imports", code: "unexpected_resources" }),
      expect.objectContaining({ category: "templates", code: "unexpected_resources" }),
      expect.objectContaining({ category: "automations", code: "unexpected_resources" }),
      expect.objectContaining({ category: "oauth_grants", code: "unexpected_resources" }),
      expect.objectContaining({ category: "contact_properties", code: "unexpected_resources" }),
      expect.objectContaining({ category: "custom_events", code: "unexpected_resources" }),
      expect.objectContaining({ category: "received_emails", code: "unexpected_resources" })
    ]));
    expect(serialized).not.toContain("resident@example.com");
    expect(serialized).not.toContain("contact-unmapped");
    expect(serialized).not.toContain("email-unmapped");
  });

  it("requires the exact dedicated domain, Segment, public opt-out Topic, webhook, and key identities", () => {
    const result = evaluateNewsletterProviderInventory({
      stage: "initial",
      configuration,
      snapshot: snapshot({
        domains: [{ id: "wrong-domain", name: "example.com", status: "verified" }],
        segments: [{ id: "wrong-segment", name: "District Newsletter" }],
        topics: [{
          id: configuration.topicId,
          name: "District Newsletter",
          defaultSubscription: "opt_in",
          visibility: "private"
        }],
        webhooks: [{
          id: "wrong-webhook",
          endpoint: "https://example.com/webhook",
          status: "disabled",
          events: []
        }],
        apiKeys: snapshot().apiKeys.slice(0, 2)
      }),
      evidence: evidence()
    });

    expect(result.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "domains", status: "blocked" }),
      expect.objectContaining({ category: "segments", status: "blocked" }),
      expect.objectContaining({ category: "topics", status: "blocked" }),
      expect.objectContaining({ category: "webhooks", status: "blocked" }),
      expect.objectContaining({ category: "api_keys", status: "blocked" })
    ]));
  });

  it("requires an empty initial Segment and local eligible set but permits mapped authentic steady state", () => {
    const authentic = snapshot({
      contacts: [{ id: "contact-1", email: "resident@example.com" }],
      segmentContacts: [{ id: "contact-1", email: "resident@example.com" }],
      broadcasts: [{
        id: "broadcast-sent",
        status: "sent",
        from: "Office of Assemblywoman Carmen Morales <newsletter@updates.assemblywomanmorales.com>",
        segmentId: configuration.segmentId,
        topicId: configuration.topicId
      }]
    });
    const authenticEvidence = evidence({
      providerContactIds: new Set(["contact-1"]),
      retainedContactEmails: new Set(["resident@example.com"]),
      allowedSentBroadcastIds: new Set(["broadcast-sent"]),
      localEligibleCount: 1
    });

    const initial = evaluateNewsletterProviderInventory({
      stage: "initial", configuration, snapshot: authentic, evidence: authenticEvidence
    });
    const steady = evaluateNewsletterProviderInventory({
      stage: "steady", configuration, snapshot: authentic, evidence: authenticEvidence
    });

    expect(initial.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "initial_boundary", status: "blocked" })
    ]));
    expect(steady.state).toBe("ready");
  });
});

function emptyPage<T>() {
  return { items: [] as T[], hasMore: false };
}

function reader(
  overrides: Partial<NewsletterProviderInventoryReader> = {}
): NewsletterProviderInventoryReader {
  return {
    probeManagementCredential: async () => "authorized",
    probeSendCredential: async () => "restricted",
    listApiKeys: async () => emptyPage(),
    listAutomations: async () => emptyPage(),
    listBroadcasts: async () => emptyPage(),
    listContacts: async () => emptyPage(),
    listSegmentContacts: async () => emptyPage(),
    listDomains: async () => emptyPage(),
    listEmails: async () => emptyPage(),
    listImports: async () => emptyPage(),
    listOauthGrants: async () => emptyPage(),
    listSegments: async () => emptyPage(),
    listSuppressions: async () => emptyPage(),
    listTemplates: async () => emptyPage(),
    listTopics: async () => emptyPage(),
    listWebhooks: async () => emptyPage(),
    listContactProperties: async () => emptyPage(),
    listCustomEvents: async () => emptyPage(),
    listReceivedEmails: async () => emptyPage(),
    ...overrides
  };
}

describe("newsletter provider inventory reader", () => {
  it("fully follows provider cursors for every read-only category", async () => {
    const contactCalls: { limit: number; after?: string }[] = [];
    const inventoryReader = reader({
      listContacts: async (page) => {
        contactCalls.push(page);
        if (!page.after) {
          return {
            items: [{ id: "contact-1", email: "first@example.com" }],
            hasMore: true,
            after: "contact-1"
          };
        }
        return {
          items: [{ id: "contact-2", email: "second@example.com" }],
          hasMore: false
        };
      },
      listTopics: async () => ({
        items: [{
          id: configuration.topicId,
          name: "District Newsletter",
          defaultSubscription: "opt_out",
          visibility: "public"
        }],
        hasMore: false
      })
    });

    const result = await collectNewsletterProviderInventory(inventoryReader);

    expect(contactCalls).toEqual([
      { limit: 100, after: undefined },
      { limit: 100, after: "contact-1" }
    ]);
    expect(result.contacts).toHaveLength(2);
    expect(result.topics).toHaveLength(1);
    expect(Object.keys(inventoryReader).some((key) =>
      /send|create|update|remove|delete|schedule/i.test(key) && key !== "probeSendCredential"
    )).toBe(false);
  });

  it("fails closed when a provider claims another page without a cursor", async () => {
    await expect(collectNewsletterProviderInventory(reader({
      listDomains: async () => ({ items: [], hasMore: true })
    }))).rejects.toThrow("unsupported_inventory");
  });

  it("fails closed instead of accepting an unbounded provider inventory", async () => {
    await expect(collectNewsletterProviderInventory(reader({
      listTemplates: async ({ after }) => ({
        items: [{ id: `template-${after ?? "0"}` }],
        hasMore: true,
        after: String(Number(after ?? "0") + 1)
      })
    }), { maximumPages: 2 })).rejects.toThrow("unsupported_inventory");
  });
});
