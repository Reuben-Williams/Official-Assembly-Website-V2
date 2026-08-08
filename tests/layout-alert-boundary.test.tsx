import type { PublicAlertProjectionV1 } from "@reuben-williams/content";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { resolveLayoutAlertBoundary } from "../lib/builder/alerts";

const projection: PublicAlertProjectionV1 = {
  schemaVersion: 1,
  revisionId: "11111111-1111-4111-8111-111111111111",
  activeAlerts: [{ id: "district-update", category: "general", message: "District update" }],
  evaluatedAt: "2026-08-08T12:00:00.000Z",
  nextTransitionAt: null,
};

describe("root layout alert boundary", () => {
  it.each([null, "", "/admin/editor", "/auth/callback", "/api/public/alerts", "/_next/static/app.js"])(
    "does not load or pass alert data for non-public header %j",
    async (pathnameHeader) => {
      const load = vi.fn(async () => projection);
      await expect(resolveLayoutAlertBoundary({ pathnameHeader, load }))
        .resolves.toEqual({ eligible: false, projection: null });
      expect(load).not.toHaveBeenCalled();
    },
  );

  it("loads the bounded public projection only for a trusted public pathname", async () => {
    const load = vi.fn(async () => projection);
    await expect(resolveLayoutAlertBoundary({ pathnameHeader: "/news", load }))
      .resolves.toEqual({ eligible: true, projection });
    expect(load).toHaveBeenCalledOnce();
  });

  it("keeps the public page available without exposing an internal load error", async () => {
    const load = vi.fn(async () => {
      throw new Error("private provider detail");
    });
    await expect(resolveLayoutAlertBoundary({ pathnameHeader: "/", load }))
      .resolves.toEqual({ eligible: true, projection: null });
  });

  it("places the conditional controller directly below the header and above main", () => {
    const layout = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8");
    const header = layout.indexOf("<AppHeader");
    const alerts = layout.indexOf("<PublicAlertController");
    const main = layout.indexOf('<main id="main">');

    expect(header).toBeGreaterThan(-1);
    expect(alerts).toBeGreaterThan(header);
    expect(main).toBeGreaterThan(alerts);
    expect(layout).toContain("alerts.eligible ? <PublicAlertController");
  });
});
