import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/script", () => ({ default: () => null }));
vi.mock("@reuben-williams/next/forms", () => ({
  BuilderForm: ({ endpoint }: { endpoint: string }) => (
    <form action={endpoint}><button>Request updates</button></form>
  ),
  UnavailableFormFallback: ({ phone }: { phone: string }) => <p>Call {phone}</p>
}));
vi.mock("../app/ui/PageTemplate", () => ({
  PageTemplate: () => <div data-page-template="news" />
}));
vi.mock("../lib/builder/server-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/builder/server-content")>();
  return { ...actual, loadBuilderServerContent: vi.fn(async () => ({ regions: {} })) };
});
vi.mock("../lib/builder/published-posts", () => ({ listPublishedPosts: vi.fn(async () => []) }));
vi.mock("../lib/newsletter/config", () => ({
  readNewsletterConfiguration: () => ({
    status: "ready" as const,
    environment: "production" as const,
    canonicalSiteUrl: "https://www.assemblywomanmorales.com",
    segmentId: "segment-id",
    topicId: "topic-id",
    activeKeyId: "key-1",
    verificationKeyIds: ["key-1"],
    testRecipientCount: 1
  })
}));
vi.mock("../lib/newsletter/readiness", () => ({
  readNewsletterPublicReadiness: vi.fn(async () => ({ status: "ready" as const }))
}));
vi.mock("../lib/supabase/admin", () => ({
  getBuilderAdminClient: () => ({ rpc: vi.fn() }),
  resolveBuilderSiteId: async () => "34000000-0000-4000-8000-000000000001"
}));
vi.mock("../lib/builder/forms", () => ({
  getManagedFormDefinition: () => ({ formKey: "newsletter-signup" }),
  createSupabasePublishedFormRepository: () => ({}),
  loadManagedFormProjection: async () => ({
    status: "ready" as const,
    projection: { formKey: "newsletter-signup" }
  })
}));

import NewsPage, { generateMetadata } from "../app/news/page";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "turnstile-site-key"));
afterEach(() => vi.unstubAllEnvs());

describe("News and Updates hub", () => {
  it("uses the combined hub name as its metadata fallback", async () => {
    await expect(generateMetadata()).resolves.toMatchObject({ title: "News & Updates" });
  });

  it("places the managed signup after published updates", async () => {
    const html = renderToStaticMarkup(await NewsPage());

    expect(html).toContain('data-builder-region="news.newsletter.form"');
    expect(html).toContain("Get News &amp; Updates by email");
    expect(html).toContain('action="/api/forms/newsletter-signup"');
    expect(html).toContain('href="/newsletter"');
    expect(html.indexOf("Published updates")).toBeLessThan(
      html.indexOf("Get News &amp; Updates by email")
    );
  });
});
