import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  normalizeNewsletterSectionIds,
  planNewsletterLayoutTransition,
} from "../lib/builder/newsletter-layout";

describe("newsletter form-first layout contract", () => {
  it("normalizes every requested order to the stable public sequence", () => {
    expect(normalizeNewsletterSectionIds([
      "supporting",
      "hero",
      "features",
      "form",
      "form",
      "unknown",
    ])).toEqual(["form", "features", "supporting"]);
    expect(normalizeNewsletterSectionIds([], true)).toEqual([
      "form",
      "features",
      "supporting",
      "secondary",
    ]);
  });

  it("normalizes newsletter section edits and leaves every other edit unchanged", async () => {
    const layoutModule = await import("../lib/builder/newsletter-layout");
    const normalize = (layoutModule as unknown as Record<string, unknown>).normalizeNewsletterEditableValue;
    expect(normalize).toBeTypeOf("function");
    if (typeof normalize !== "function") return;

    expect(normalize({
      pagePath: "/newsletter",
      regionId: "newsletter.sections",
      value: { type: "sections", value: ["supporting", "form"] },
    })).toEqual({ type: "sections", value: ["form", "features", "supporting"] });

    const otherValue = { type: "sections", value: ["supporting", "form"] };
    expect(normalize({
      pagePath: "/contact",
      regionId: "contact.sections",
      value: otherValue,
    })).toBe(otherValue);
  });

  it("rejects a publish snapshot whose newsletter order escaped normalization", async () => {
    const layoutModule = await import("../lib/builder/newsletter-layout");
    const validate = (layoutModule as unknown as Record<string, unknown>).validateNewsletterLayoutSnapshot;
    expect(validate).toBeTypeOf("function");
    if (typeof validate !== "function") return;

    expect(() => validate({
      pagePath: "/newsletter",
      regions: {
        "newsletter.sections": { type: "sections", value: ["features", "form", "supporting"] },
      },
    })).toThrow(/form-first/i);

    expect(() => validate({
      pagePath: "/newsletter",
      regions: {
        "newsletter.sections": { type: "sections", value: ["form", "features", "supporting"] },
      },
    })).not.toThrow();
  });

  it("composes newsletter normalization with the protected-brand route hooks", () => {
    const route = readFileSync(new URL("../app/api/builder/route.ts", import.meta.url), "utf8");
    expect(route).toContain("normalizeNewsletterEditableValue");
    expect(route).toContain("validateNewsletterLayoutSnapshot");
    expect(route).toMatch(/normalizeProtectedBrandValue[\s\S]*normalizeNewsletterEditableValue/);
    expect(route).toMatch(/validateProtectedBrandSnapshot[\s\S]*validateNewsletterLayoutSnapshot/);
  });

  it("plans a versioned transition that preserves retained regions and retires old hero fields", async () => {
    const layoutModule = await import("../lib/builder/newsletter-layout");
    const plan = (layoutModule as unknown as Record<string, unknown>).planNewsletterLayoutTransition;
    expect(plan).toBeTypeOf("function");
    if (typeof plan !== "function") return;

    expect(plan({
      draft: {
        versionId: "draft-v1",
        regions: {
          "newsletter.hero.title": { type: "text", value: "Old title" },
          "newsletter.hero.primary-cta": { type: "link", href: "/contact", label: "Old CTA" },
          "newsletter.form.title": { type: "text", value: "Current title" },
          "newsletter.sections": { type: "sections", value: ["hero", "supporting", "form"] },
        },
      },
      published: {
        versionId: "published-v1",
        regions: {
          "newsletter.hero.title": { type: "text", value: "Old title" },
          "newsletter.hero.primary-cta": { type: "link", href: "/contact", label: "Old CTA" },
          "newsletter.form.title": { type: "text", value: "Current title" },
          "newsletter.sections": { type: "sections", value: ["hero", "supporting", "form"] },
        },
      },
    })).toEqual({
      status: "changes_required",
      expectedDraftVersionId: "draft-v1",
      expectedPublishedVersionId: "published-v1",
      retiredRegionIds: ["newsletter.hero.primary-cta", "newsletter.hero.title"],
      values: {
        "newsletter.form.title": { type: "text", value: "Current title" },
        "newsletter.sections": { type: "sections", value: ["form", "features", "supporting"] },
      },
    });
  });

  it("reports no-op replay and blocks unrelated pending draft content", async () => {
    const layoutModule = await import("../lib/builder/newsletter-layout");
    const plan = (layoutModule as unknown as Record<string, unknown>).planNewsletterLayoutTransition;
    expect(plan).toBeTypeOf("function");
    if (typeof plan !== "function") return;

    const current = {
      "newsletter.form.title": { type: "text", value: "Current title" },
      "newsletter.sections": { type: "sections", value: ["form", "features", "supporting"] },
    };
    expect(plan({
      draft: { versionId: "draft-v2", regions: current },
      published: { versionId: "published-v2", regions: current },
    })).toMatchObject({ status: "already_current" });

    expect(plan({
      draft: {
        versionId: "draft-v3",
        regions: { ...current, "newsletter.form.body": { type: "text", value: "Unpublished copy" } },
      },
      published: { versionId: "published-v3", regions: current },
    })).toMatchObject({ status: "blocked_pending_draft" });
  });

  it("represents an absent draft version as an explicit null command precondition", () => {
    const plan = planNewsletterLayoutTransition({
      draft: { versionId: undefined, regions: {} },
      published: { versionId: "published-v4", regions: {} },
    } as unknown as Parameters<typeof planNewsletterLayoutTransition>[0]);

    expect(plan.expectedDraftVersionId).toBeNull();
    expect(plan.expectedPublishedVersionId).toBe("published-v4");
  });

  it("ships a dry-run-first migration command without direct published-row mutation", () => {
    const path = new URL("../scripts/migrate-newsletter-form-first-layout.mjs", import.meta.url);
    expect(existsSync(path)).toBe(true);
    if (!existsSync(path)) return;
    const source = readFileSync(path, "utf8");
    expect(source).toContain("--apply");
    expect(source).toContain("planNewsletterLayoutTransition");
    expect(source).toContain("createBuilderContentCommand");
    expect(source).not.toMatch(/builder_published_pages[\s\S]*\.(?:update|upsert|delete|insert)\s*\(/);
  });
});
