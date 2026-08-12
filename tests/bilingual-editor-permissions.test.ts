import { describe, expect, it } from "vitest";

import {
  bilingualCapabilityForOperation,
  roleCanPerformBilingualOperation,
} from "../lib/builder/localization";

describe("bilingual editor permissions", () => {
  it("maps each operation to the published translation capability contract", () => {
    expect(bilingualCapabilityForOperation("read")).toBe("translations.read");
    expect(bilingualCapabilityForOperation("save_draft")).toBe("translations.editDraft");
    expect(bilingualCapabilityForOperation("submit_review")).toBe("translations.editDraft");
    expect(bilingualCapabilityForOperation("approve")).toBe("translations.approve");
    expect(bilingualCapabilityForOperation("stage")).toBe("translations.editDraft");
    expect(bilingualCapabilityForOperation("publish")).toBe("post.publish");
    expect(bilingualCapabilityForOperation("restore")).toBe("post.rollback");
    expect(bilingualCapabilityForOperation("activate")).toBe("members.manage");
  });

  it("allows authoring and review by role without weakening activation", () => {
    expect(roleCanPerformBilingualOperation("viewer", "read")).toBe(true);
    expect(roleCanPerformBilingualOperation("viewer", "save_draft")).toBe(false);
    expect(roleCanPerformBilingualOperation("contributor", "save_draft")).toBe(true);
    expect(roleCanPerformBilingualOperation("contributor", "approve")).toBe(false);
    expect(roleCanPerformBilingualOperation("editor", "approve")).toBe(true);
    expect(roleCanPerformBilingualOperation("editor", "publish")).toBe(true);
    expect(roleCanPerformBilingualOperation("editor", "activate")).toBe(false);
    expect(roleCanPerformBilingualOperation("owner", "activate")).toBe(true);
  });
});
