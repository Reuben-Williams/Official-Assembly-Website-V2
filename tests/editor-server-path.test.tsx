import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "assembly.example" }))
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../lib/builder/request-auth", () => ({
  authenticateBuilderRequest: vi.fn(async () => ({ userId: "member-1", role: "owner" }))
}));
vi.mock("../lib/builder/published-posts", () => ({
  listPublishedPosts: vi.fn(async () => []),
  toLinkablePosts: vi.fn(() => [])
}));
vi.mock("../lib/supabase/admin", () => ({ getBuilderAdminClient: vi.fn(() => null) }));

import AdminEditorPage from "../app/admin/editor/page";

describe("server-owned editor path", () => {
  it("passes a validated bookmarked page into the first client render", async () => {
    const page = await AdminEditorPage({
      searchParams: Promise.resolve({ path: "/404" })
    });

    expect(React.isValidElement(page)).toBe(true);
    expect(page.props.initialPath).toBe("/404");
  });
});
