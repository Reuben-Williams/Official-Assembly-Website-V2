import { describe, expect, it } from "vitest";

import { isGrowthModuleOperational } from "../lib/growth/server";
import { liveGrowthEmptyCopy } from "../app/admin/editor/live-growth-workspaces";

describe("growth module activation", () => {
  it("describes empty production workspaces without inventing records", () => {
    expect(liveGrowthEmptyCopy("submissions")).toBe("When this workspace is empty, there are no live submission records to review.");
    expect(liveGrowthEmptyCopy("leads")).toBe("When this workspace is empty, there are no live lead records to review.");
    expect(liveGrowthEmptyCopy("customers")).toBe("When this workspace is empty, there are no live customer records to review.");
  });

  it("recognizes the platform's fail-closed default marker on an active configured module", () => {
    expect(
      isGrowthModuleOperational({
        setup_status: "configured",
        entitlement_state: "active",
        disabled_by_default: true
      })
    ).toBe(true);
  });

  it("rejects missing, incomplete, or inactive module state", () => {
    expect(isGrowthModuleOperational(null)).toBe(false);
    expect(
      isGrowthModuleOperational({
        setup_status: "setup_required",
        entitlement_state: "active",
        disabled_by_default: true
      })
    ).toBe(false);
    expect(
      isGrowthModuleOperational({
        setup_status: "configured",
        entitlement_state: "suspended",
        disabled_by_default: true
      })
    ).toBe(false);
  });
});
