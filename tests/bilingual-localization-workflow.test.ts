import {
  inspectLocalizedDomainReadinessV1,
  type LocalizedDomainRevisionV1,
} from "@reuben-williams/content";
import { describe, expect, it } from "vitest";

import {
  createInitialLocalizedRevision,
  reviseSpanishLocalization,
  type LocalizationInventoryItem,
} from "../lib/builder/localization";

const siteId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";

const item: LocalizationInventoryItem = {
  domain: "site",
  stableId: "home.hero",
  fieldId: "home.hero.title",
  english: "District 34 updates",
  spanish: null,
  status: "missing",
  sourceDigest: "0".repeat(64),
  exemptionEligible: false,
  source: "test",
};

describe("bilingual localization workflow", () => {
  it("creates an immutable first revision from the reviewed inventory", async () => {
    const revision = await createInitialLocalizedRevision({
      siteId,
      actorId,
      revisionId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-08-12T12:00:00.000Z",
      domain: "site",
      stableId: "home.hero",
      items: [item],
    });

    expect(revision).toMatchObject({
      schemaVersion: 1,
      siteId,
      domain: "site",
      stableId: "home.hero",
      parentRevisionId: null,
      createdBy: actorId,
    });
    await expect(inspectLocalizedDomainReadinessV1(revision)).resolves.toMatchObject({
      ready: false,
      blockers: [{ code: "TRANSLATION_MISSING", fieldId: "home.hero.title" }],
    });
  });

  it("drafts, submits, and approves Spanish as separate immutable revisions", async () => {
    const initial = await createInitialLocalizedRevision({
      siteId,
      actorId,
      revisionId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-08-12T12:00:00.000Z",
      domain: "site",
      stableId: "home.hero",
      items: [item],
    });
    const draft = await reviseSpanishLocalization(initial, {
      operation: "save_draft",
      fieldId: item.fieldId,
      spanish: "Actualizaciones del Distrito 34",
      actorId,
      revisionId: "44444444-4444-4444-8444-444444444444",
      createdAt: "2026-08-12T12:01:00.000Z",
    });
    const submitted = await reviseSpanishLocalization(draft, {
      operation: "submit_review",
      fieldId: item.fieldId,
      actorId,
      revisionId: "55555555-5555-4555-8555-555555555555",
      createdAt: "2026-08-12T12:02:00.000Z",
    });
    const approved = await reviseSpanishLocalization(submitted, {
      operation: "approve",
      fieldId: item.fieldId,
      actorId,
      revisionId: "66666666-6666-4666-8666-666666666666",
      createdAt: "2026-08-12T12:03:00.000Z",
    });

    expect(initial.fields[0]).toMatchObject({ kind: "text", value: { es: { mode: "missing" } } });
    expect(draft.parentRevisionId).toBe(initial.revisionId);
    expect(submitted.parentRevisionId).toBe(draft.revisionId);
    expect(approved.parentRevisionId).toBe(submitted.revisionId);
    expect((approved as LocalizedDomainRevisionV1).fields[0]).toMatchObject({
      kind: "text",
      value: { es: { mode: "translated", status: "approved" } },
    });
    await expect(inspectLocalizedDomainReadinessV1(approved)).resolves.toMatchObject({
      ready: true,
      blockers: [],
    });
  });
});
