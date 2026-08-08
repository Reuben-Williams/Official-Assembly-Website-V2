import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NewsletterConfigurationState } from "../lib/newsletter/types";

const mocks = vi.hoisted(() => ({
  configuration: vi.fn<() => NewsletterConfigurationState>(() => ({
    status: "ready" as const,
    environment: "production" as const,
    canonicalSiteUrl: "https://www.assemblywomanmorales.com",
    segmentId: "segment-id",
    topicId: "topic-id",
    activeKeyId: "key-1",
    verificationKeyIds: ["key-1"],
    testRecipientCount: 1
  })),
  readiness: vi.fn(async () => ({ status: "ready" as const }))
}));

vi.mock("next/script", () => ({ default: () => null }));
vi.mock("@reuben-williams/next/forms", () => ({
  BuilderForm: ({ endpoint }: { endpoint: string }) => <form action={endpoint}><button>Request updates</button></form>,
  UnavailableFormFallback: ({ phone }: { phone: string }) => <p>Call {phone}</p>
}));
vi.mock("../lib/newsletter/config", () => ({ readNewsletterConfiguration: mocks.configuration }));
vi.mock("../lib/newsletter/readiness", () => ({ readNewsletterPublicReadiness: mocks.readiness }));
vi.mock("../lib/builder/server-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/builder/server-content")>();
  return { ...actual, loadBuilderServerContent: vi.fn(async () => ({ regions: {} })) };
});
vi.mock("../lib/supabase/admin", () => ({
  getBuilderAdminClient: () => ({ rpc: vi.fn() }),
  resolveBuilderSiteId: async () => "34000000-0000-4000-8000-000000000001"
}));
vi.mock("../lib/builder/forms", () => ({
  getManagedFormDefinition: (type: string) => type === "survey" ? null : { formKey: type },
  createSupabasePublishedFormRepository: () => ({}),
  loadManagedFormProjection: async () => ({
    status: "ready" as const,
    projection: { formKey: "newsletter-signup" }
  })
}));

import PrivacyPage from "../app/privacy/page";
import { getPageBySlug } from "../app/data/site";
import { PageTemplate } from "../app/ui/PageTemplate";
import { ResidentForm } from "../app/ui/ResidentForms";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "turnstile-site-key");
  mocks.configuration.mockReturnValue({
    status: "ready",
    environment: "production",
    canonicalSiteUrl: "https://www.assemblywomanmorales.com",
    segmentId: "segment-id",
    topicId: "topic-id",
    activeKeyId: "key-1",
    verificationKeyIds: ["key-1"],
    testRecipientCount: 1
  });
  mocks.readiness.mockResolvedValue({ status: "ready" });
});

afterEach(() => vi.unstubAllEnvs());

describe("public newsletter and privacy experience", () => {
  it("keeps exactly one managed signup on the dedicated Newsletter page", async () => {
    const newsletter = getPageBySlug("newsletter");
    expect(newsletter).toBeDefined();

    const html = renderToStaticMarkup(await PageTemplate({ page: newsletter! }));
    expect(html.match(/action="\/api\/forms\/newsletter-signup"/g)).toHaveLength(1);
    expect(html).toContain('data-builder-region="global.template.form-title"');
    expect(html).toContain('data-builder-region="newsletter.form"');
  });

  it("states the pending confirmation boundary and links privacy before active signup", async () => {
    const html = renderToStaticMarkup(await ResidentForm({ type: "newsletter" }));

    expect(html).toContain("You are not subscribed until you confirm");
    expect(html).toContain("Verification runs automatically");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('action="/api/forms/newsletter-signup"');
    expect(html).not.toContain("You are now subscribed");
    expect(html).not.toContain("newsletter delivery is active");
  });

  it("fails closed to district contact and exposes no form endpoint when unready", async () => {
    mocks.configuration.mockReturnValue({
      status: "disabled",
      code: "newsletter_disabled",
      environment: "production"
    });
    const html = renderToStaticMarkup(await ResidentForm({ type: "newsletter" }));

    expect(html).toContain("Call");
    expect(html).not.toContain("/api/forms/newsletter-signup");
    expect(html).not.toContain("Request updates");
  });

  it("publishes the approved privacy subjects without unsupported legal promises", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    for (const text of [
      "email address",
      "optional first name",
      "Resend",
      "confirmation",
      "unsubscribe link",
      "access, correct, or delete",
      "retention"
    ]) expect(html.toLowerCase()).toContain(text.toLowerCase());
    expect(html).toContain('href="/contact"');
    expect(html).toContain("(973) 450-0484");
    expect(html).not.toMatch(/guarantee|legal advice|GDPR|HIPAA/);
  });
});
