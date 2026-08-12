import { describe, expect, it } from "vitest";

import { validateNewsletterOwnerLoginEvidenceRows } from "../lib/newsletter/provider-inventory-repository";

const evidence = [{
  provider_message_id: "message-1",
  policy_version: "resend-owner-login-v1"
}];

function receipt(eventType: string, overrides: Record<string, unknown> = {}) {
  return {
    provider_message_id: "message-1",
    provider_broadcast_id: null,
    provider_scope_id: "resend-team-production",
    disposition: "matched",
    event_type: eventType,
    ...overrides
  };
}

describe("ongoing owner-login inventory evidence", () => {
  it("requires exactly one matched sent and delivered receipt and permits open/click receipts", () => {
    expect(validateNewsletterOwnerLoginEvidenceRows(evidence, [
      receipt("email.sent"),
      receipt("email.delivered"),
      receipt("email.opened"),
      receipt("email.clicked")
    ])).toBe(true);
  });

  it("fails closed on policy drift, receipt cardinality, event scope, or broadcast linkage", () => {
    expect(validateNewsletterOwnerLoginEvidenceRows([
      { ...evidence[0]!, policy_version: "old-policy" }
    ], [receipt("email.sent"), receipt("email.delivered")])).toBe(false);
    expect(validateNewsletterOwnerLoginEvidenceRows(evidence, [
      receipt("email.sent"), receipt("email.sent"), receipt("email.delivered")
    ])).toBe(false);
    expect(validateNewsletterOwnerLoginEvidenceRows(evidence, [
      receipt("email.sent"), receipt("email.delivered", { disposition: "ignored" })
    ])).toBe(false);
    expect(validateNewsletterOwnerLoginEvidenceRows(evidence, [
      receipt("email.sent"), receipt("email.delivered"),
      receipt("email.failed")
    ])).toBe(false);
    expect(validateNewsletterOwnerLoginEvidenceRows(evidence, [
      receipt("email.sent"), receipt("email.delivered", { provider_broadcast_id: "broadcast-id" })
    ])).toBe(false);
  });
});
