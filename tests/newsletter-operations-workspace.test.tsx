// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NewsletterOperationsWorkspace } from "../app/admin/editor/newsletter-operations-workspace";
import { createNewsletterOperationsClient } from "../lib/newsletter/operations-client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const digest = "a".repeat(64);
const status = {
  version: 1 as const,
  queuedJobs: 2,
  openIncidents: 0,
  providerActivation: { active: false, recordedAt: "" },
  providerAttestation: { current: false, expiresAt: "" },
  authSmtpProofs: { replacementLogin: false, postRevocationLogin: false },
  reconciliationCircuit: { state: "closed" as const, code: "" },
  confirmedTest: {
    id: "34700000-0000-4000-8000-000000000001",
    providerBroadcastId: "broadcast_1",
    digest,
    confirmedAt: "2026-08-06T18:00:00.000Z"
  },
  validation: {
    id: "34400000-0000-4000-8000-000000000001",
    providerBroadcastId: "broadcast_1",
    digest,
    audienceCount: 125,
    validatedAt: "2026-08-06T18:01:00.000Z",
    validUntil: "2026-08-06T18:11:00.000Z",
    state: "valid",
    readinessRevisionId: "34100000-0000-4000-8000-000000000001"
  }
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("newsletter operations workspace", () => {
  it("shows bounded live status and owner-only operational controls", async () => {
    const client = {
      status: vi.fn(async () => status),
      providerInventory: vi.fn(async () => ({
        state: "blocked" as const,
        activationReady: false,
        mode: "disabled_setup" as const,
        policyVersion: "resend-district-newsletter-v1",
        categories: [
          {
            category: "manual_attestation",
            status: "blocked" as const,
            code: "manual_attestation_missing",
            count: 0
          },
          {
            category: "transactional_emails",
            status: "blocked" as const,
            code: "unmapped_email_history",
            count: 10
          }
        ],
        counts: { contacts: 0, segmentContacts: 0, suppressions: 0, broadcasts: 0, sentBroadcasts: 0, emails: 10, localEligible: 0 }
      })),
      recordProviderAttestation: vi.fn(async () => ({ state: "recorded" as const })),
      recordAuthSmtpProof: vi.fn(async () => ({ state: "recorded" as const })),
      activateProvider: vi.fn(async () => ({ state: "active" as const })),
      recoverReconciliation: vi.fn(async () => ({ state: "queued" as const })),
      reconcileProviderHistory: vi.fn(async () => ({ state: "reconciled" as const })),
      activationCheck: vi.fn(),
      openStaffTestWindow: vi.fn(async () => ({ state: "open" as const, windowId: "window_1" })),
      validate: vi.fn()
    };
    await act(async () => root.render(
      <NewsletterOperationsWorkspace client={client} role="owner" />
    ));
    await settle();

    expect(host.textContent).toContain("Newsletter operations");
    expect(host.textContent).toContain("2 queued jobs");
    expect(host.textContent).toContain("125 confirmed subscribers");
    expect(host.textContent).toContain("aaaaaaaaaaaa…");
    expect(host.textContent).not.toContain(digest);
    expect(host.textContent).not.toContain("message body");
    expect(host.querySelector('a[href="https://resend.com/broadcasts"]')?.textContent).toContain("Open Resend");
    expect(Array.from(host.querySelectorAll("button")).map((button) => button.textContent)).toEqual(
      expect.arrayContaining([
        "Confirm dashboard review",
        "Record replacement login proof",
        "Record post-revocation login proof",
        "Run activation check",
        "Open staff test window",
        "Validate newsletter"
      ])
    );
    const inventoryButton = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === "Run provider inventory")!;
    await act(async () => inventoryButton.click());
    await settle();
    expect(client.providerInventory).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("manual attestation missing");
    expect(host.textContent).not.toContain("resourceIdentityDigest");

    const reconciliationButton = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === "Reconcile verified history")!;
    expect(reconciliationButton.disabled).toBe(false);
    await act(async () => reconciliationButton.click());
    await settle();
    expect(client.reconcileProviderHistory).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f-]{36}$/)
    );

    const attestationButton = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === "Confirm dashboard review")!;
    await act(async () => attestationButton.click());
    await settle();
    expect(client.recordProviderAttestation).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/));

    const authProofButton = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === "Record replacement login proof")!;
    await act(async () => authProofButton.click());
    await settle();
    expect(client.recordAuthSmtpProof).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      "replacement_login"
    );
  });

  it("keeps non-owner roles read-only and exposes loading and error states", async () => {
    let rejectStatus!: (reason: Error) => void;
    const client = {
      status: vi.fn(() => new Promise<typeof status>((_, reject) => { rejectStatus = reject; })),
      providerInventory: vi.fn(),
      recordProviderAttestation: vi.fn(),
      recordAuthSmtpProof: vi.fn(),
      activateProvider: vi.fn(),
      recoverReconciliation: vi.fn(),
      reconcileProviderHistory: vi.fn(),
      activationCheck: vi.fn(),
      openStaffTestWindow: vi.fn(),
      validate: vi.fn()
    };
    await act(async () => root.render(
      <NewsletterOperationsWorkspace client={client} role="viewer" />
    ));
    expect(host.textContent).toContain("Loading live newsletter status");
    expect(host.textContent).toContain("Read-only access");
    expect(host.textContent).not.toContain("Open staff test window");
    expect(host.textContent).not.toContain("Validate newsletter");
    expect(host.textContent).not.toContain("Run provider inventory");

    rejectStatus(new Error("secret provider payload"));
    await settle();
    expect(host.textContent).toContain("Newsletter status is temporarily unavailable");
    expect(host.textContent).not.toContain("secret provider payload");
  });

  it("sends same-origin JSON mutations with the editor CSRF header", async () => {
    const fetchMock = vi.fn(async () => Response.json({ state: "open", windowId: "window_1" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createNewsletterOperationsClient(() => "csrf-token");
    await client.openStaffTestWindow("broadcast_1", "34200000-0000-4000-8000-000000000001");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/newsletter/operations/staff-test",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-builder-csrf": "csrf-token"
        })
      })
    );
  });
});
