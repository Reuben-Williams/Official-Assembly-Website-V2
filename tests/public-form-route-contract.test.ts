import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captures = vi.hoisted(() => ({
  dependencies: null as null | {
    locale: string;
    rateLimits: {
      network: { limit: number; windowMs: number };
      identity: { limit: number; windowMs: number };
    };
  }
}));

vi.mock("@reuben-williams/next/forms/server", () => ({
  createPublicFormSubmissionRoute: (dependencies: typeof captures.dependencies) => {
    captures.dependencies = dependencies;
    return { handle: async () => Response.json({ accepted: true }, { status: 202 }) };
  }
}));

vi.mock("@reuben-williams/next/ingestion/server", () => ({
  createCloudflareTurnstileVerifier: () => ({}),
  createHmacFingerprintService: () => ({}),
  createVercelTrustedNetworkAdapter: () => ({})
}));

vi.mock("@reuben-williams/forms", () => ({
  APPROVED_FORM_TEMPLATES: [{ id: "local-business.newsletter-signup", version: "1.0.0" }]
}));

vi.mock("../app/data/site", () => ({
  siteConfig: { officeName: "Office of Assemblywoman Carmen Theresa Morales" }
}));

vi.mock("../lib/builder/forms", () => ({
  createSupabasePublishedFormRepository: () => ({}),
  getManagedFormDefinition: () => ({
    templateId: "local-business.newsletter-signup",
    templateVersion: "1.0.0",
    action: "newsletter"
  }),
  isManagedPublicFormKey: () => true
}));

vi.mock("../lib/builder/authorization", () => ({
  allowedBuilderOrigins: (origin: string) => [origin]
}));

vi.mock("../lib/newsletter/config", () => ({
  readNewsletterConfiguration: () => ({ status: "ready", activeKeyId: "2026-08" })
}));

vi.mock("../lib/newsletter/ingestion", () => ({
  createManagedPublicFormIngestionService: () => ({})
}));

vi.mock("../lib/newsletter/managed-form-revision", () => ({
  createPackageCompatibleNewsletterSubmissionRequest: async ({ request }: { request: Request }) => request
}));

vi.mock("../lib/newsletter/readiness", () => ({
  readNewsletterPublicReadiness: async () => ({ status: "ready" })
}));

vi.mock("../lib/supabase/admin", () => ({
  getBuilderAdminClient: () => ({ rpc: vi.fn() }),
  resolveBuilderSiteId: async () => "a3f57b25-df25-4d98-9ff6-a4a3f3a00a68"
}));

import { POST } from "../app/api/forms/[formKey]/route";

beforeEach(() => {
  captures.dependencies = null;
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "turnstile-site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "turnstile-secret-key");
  vi.stubEnv("FORM_FINGERPRINT_SECRET", "f".repeat(32));
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.assemblywomanmorales.com");
});

afterEach(() => vi.unstubAllEnvs());

describe("public form route rate-limit contract", () => {
  it("matches the production SQL network and identity window durations", async () => {
    const response = await POST(
      new Request("https://www.assemblywomanmorales.com/api/forms/newsletter-signup", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "assembly-language=es" },
        body: "{}"
      }),
      { params: Promise.resolve({ formKey: "newsletter-signup" }) }
    );

    expect(response.status).toBe(202);
    expect(captures.dependencies?.rateLimits).toEqual({
      network: { limit: 10, windowMs: 60 * 60_000 },
      identity: { limit: 5, windowMs: 15 * 60_000 }
    });
    expect(captures.dependencies?.locale).toBe("es-US");
  });
});
