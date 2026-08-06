import { afterEach, describe, expect, it } from "vitest";

import {
  BuilderAuthorizationError,
  authorizeBuilderRequest,
  isSafeReturnPath,
  roleCanPerformBuilderOperation
} from "../lib/builder/authorization";
import { authorizePrivateMediaOperator } from "../lib/builder/media-operator";

const origin = "http://localhost:3000";

afterEach(() => {
  delete process.env.BUILDER_MEDIA_IMPORT_TOKEN;
  delete process.env.VERCEL_ENV;
});

describe("builder authorization", () => {
  it("accepts only same-site relative return paths", () => {
    expect(isSafeReturnPath("/admin/editor?tab=content")).toBe(true);
    expect(isSafeReturnPath("//evil.example/admin")).toBe(false);
    expect(isSafeReturnPath("https://evil.example/admin")).toBe(false);
    expect(isSafeReturnPath("/\\evil")).toBe(false);
  });

  it("uses the package role capabilities for every operation", () => {
    expect(roleCanPerformBuilderOperation("viewer", "content.readDraft")).toBe(true);
    expect(roleCanPerformBuilderOperation("viewer", "content.editDraft")).toBe(false);
    expect(roleCanPerformBuilderOperation("contributor", "content.editDraft")).toBe(true);
    expect(roleCanPerformBuilderOperation("contributor", "content.publish")).toBe(false);
    expect(roleCanPerformBuilderOperation("editor", "content.publish")).toBe(true);
    expect(roleCanPerformBuilderOperation("owner", "history.rollback")).toBe(true);
  });

  it("allows public published reads without creating an editor identity", async () => {
    const result = await authorizeBuilderRequest({
      request: new Request(`${origin}/api/builder?mode=published`),
      operation: "content.readPublished",
      allowedOrigins: [origin],
      authenticate: async () => null
    });
    expect(result).toBeNull();
  });

  it("rejects foreign origins before a cookie-authenticated mutation", async () => {
    await expect(
      authorizeBuilderRequest({
        request: new Request(`${origin}/api/builder`, {
          method: "POST",
          headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" }
        }),
        operation: "content.editDraft",
        allowedOrigins: [origin],
        authenticate: async () => ({
          userId: "user-1",
          role: "owner",
          siteKey: "official-assembly-website-v2",
          siteId: "site-1",
          sessionGeneration: 2,
          tokenGeneration: 2
        })
      })
    ).rejects.toMatchObject({ code: "ORIGIN_REJECTED", status: 403 });
  });

  it("invalidates a previously issued editor session after generation changes", async () => {
    await expect(
      authorizeBuilderRequest({
        request: new Request(`${origin}/api/builder?mode=draft`),
        operation: "content.readDraft",
        allowedOrigins: [origin],
        authenticate: async () => ({
          userId: "user-1",
          role: "owner",
          siteKey: "official-assembly-website-v2",
          siteId: "site-1",
          sessionGeneration: 3,
          tokenGeneration: 2
        })
      })
    ).rejects.toEqual(
      new BuilderAuthorizationError(
        "AUTH_SESSION_REVOKED",
        401,
        "The editor session is no longer active."
      )
    );
  });

  it("allows the one-time private media operator only in production with the exact token", () => {
    const token = "a".repeat(64);
    process.env.BUILDER_MEDIA_IMPORT_TOKEN = token;
    process.env.VERCEL_ENV = "production";

    expect(authorizePrivateMediaOperator(new Request(origin))).toBeNull();
    expect(authorizePrivateMediaOperator(new Request(origin, {
      headers: { "x-builder-media-import-token": "b".repeat(64) }
    }))).toBeNull();
    expect(authorizePrivateMediaOperator(new Request(origin, {
      headers: { "x-builder-media-import-token": token }
    }))).toMatchObject({
      role: "owner",
      siteKey: "official-assembly-website-v2",
      siteId: "a3f57b25-df25-4d98-9ff6-a4a3f3a00a68",
      userId: "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1"
    });
  });
});
