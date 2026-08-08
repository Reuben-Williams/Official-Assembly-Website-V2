import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "assembly.example" }))
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  })
}));
vi.mock("../lib/builder/request-auth", () => ({
  authenticateBuilderRequest: vi.fn(async () => ({ userId: "member-1", role: "owner" }))
}));
vi.mock("../lib/builder/published-posts", () => ({
  listPublishedPosts: vi.fn(async () => []),
  toLinkablePosts: vi.fn(() => [])
}));
vi.mock("../lib/supabase/admin", () => ({ getBuilderAdminClient: vi.fn(() => null) }));

import AdminEditorPage from "../app/admin/editor/page";
import { authenticateBuilderRequest } from "../lib/builder/request-auth";

describe("server-owned editor path", () => {
  it("passes a validated bookmarked page into the first client render", async () => {
    const page = await AdminEditorPage({
      searchParams: Promise.resolve({ path: "/404" })
    });

    expect(React.isValidElement(page)).toBe(true);
    expect(page.props.initialPath).toBe("/404");
  });

  it("preserves a direct Forms workspace return path", async () => {
    const page = await AdminEditorPage({
      searchParams: Promise.resolve({ workspace: "website.forms" })
    });
    expect(page.props.initialPath).toBe("/");

    vi.mocked(authenticateBuilderRequest).mockResolvedValueOnce(null);
    await expect(AdminEditorPage({
      searchParams: Promise.resolve({ workspace: "website.forms" })
    })).rejects.toThrow(
      "REDIRECT:/admin/login?returnTo=%2Fadmin%2Feditor%3Fworkspace%3Dwebsite.forms"
    );
  });

  it("preserves a direct Alerts workspace return path", async () => {
    const page = await AdminEditorPage({
      searchParams: Promise.resolve({ workspace: "website.alerts" })
    });
    expect(page.props.initialPath).toBe("/");

    vi.mocked(authenticateBuilderRequest).mockResolvedValueOnce(null);
    await expect(AdminEditorPage({
      searchParams: Promise.resolve({ workspace: "website.alerts" })
    })).rejects.toThrow(
      "REDIRECT:/admin/login?returnTo=%2Fadmin%2Feditor%3Fworkspace%3Dwebsite.alerts"
    );
  });

  it("preserves a validated bookmarked page through staff sign-in", async () => {
    vi.mocked(authenticateBuilderRequest).mockResolvedValueOnce(null);

    await expect(AdminEditorPage({
      searchParams: Promise.resolve({ workspace: "website.pages", path: "/404" })
    })).rejects.toThrow(
      "REDIRECT:/admin/login?returnTo=%2Fadmin%2Feditor%3Fworkspace%3Dwebsite.pages%26path%3D%252F404"
    );
  });
});
