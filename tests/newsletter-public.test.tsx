import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
// @ts-expect-error The installed JSDOM runtime does not include TypeScript declarations.
import { JSDOM } from "jsdom";
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
  BuilderForm: ({ endpoint, projection }: {
    endpoint: string;
    projection: {
      displayName: string;
      fields: Array<{ key: string; label: string; required: boolean }>;
    };
  }) => (
    <form action={endpoint}>
      <fieldset>
        <legend>{projection.displayName}</legend>
        {projection.fields.map((field) => <label key={field.key}>{field.label}{field.required ? " *" : ""}</label>)}
      </fieldset>
      <button>Request updates</button>
    </form>
  ),
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
  localizedManagedFormProjection: (_type: string, projection: unknown) => projection,
  getManagedFormDefinition: (type: string) => type === "survey" ? null : { formKey: type },
  createSupabasePublishedFormRepository: () => ({}),
  loadManagedFormProjection: async (type: "contact" | "newsletter") => {
    const newsletter = type === "newsletter";
    return {
      status: "ready" as const,
      projection: {
        formKey: newsletter ? "newsletter-signup" : "contact",
        revisionId: "30000000-0000-4000-8000-000000000001",
        displayName: newsletter ? "District Newsletter" : "Contact",
        fields: newsletter ? [
          { key: "email", label: "Email address", helpText: "", placeholder: "", kind: "email", required: true },
          { key: "firstName", label: "First name", helpText: "", placeholder: "", kind: "text", required: false },
          { key: "marketingConsent", label: "Marketing consent", helpText: "", placeholder: "", kind: "consent", required: true }
        ] : [
          { key: "firstName", label: "First name", helpText: "", placeholder: "", kind: "text", required: true },
          { key: "email", label: "Email", helpText: "", placeholder: "", kind: "email", required: false },
          { key: "operationalConsent", label: "Contact consent", helpText: "", placeholder: "", kind: "consent", required: true }
        ],
        consent: {
          fieldKey: newsletter ? "marketingConsent" : "operationalConsent",
          policyVersion: newsletter ? "marketing-v1" : "operational-v1",
          renderedText: "Approved consent"
        },
        completion: { mode: "inline_success" },
        turnstile: { siteKey: "turnstile-site-key", action: newsletter ? "newsletter" : "contact" }
      }
    };
  }
}));

import { PrivacyPageContent } from "../app/privacy/PrivacyPageContent";
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
  it("puts the compact heading and one managed signup first without newsletter photography", async () => {
    const newsletter = getPageBySlug("newsletter");
    expect(newsletter).toBeDefined();

    const html = renderToStaticMarkup(await PageTemplate({
      page: newsletter!,
      content: {
        regions: {
          "newsletter.sections": {
            type: "sections",
            value: ["supporting", "hero", "features", "form", "form", "unknown"],
          },
        },
      },
    }));
    const document = new JSDOM(html).window.document as Document;
    const page = document.querySelector('[data-newsletter-page-view="true"]');
    const items = Array.from(page?.children ?? [])
      .map((element) => element.getAttribute("data-builder-item-id"))
      .filter(Boolean);
    const headings = Array.from(document.querySelectorAll("h1"));
    const heading = headings[0];
    const firstSection = page?.firstElementChild;
    const headingBlock = firstSection?.querySelector(".newsletter-first-copy");
    const formRegion = firstSection?.querySelector('[data-builder-region="newsletter.form"]');

    expect(items).toEqual(["form", "features", "supporting"]);
    expect(firstSection?.getAttribute("data-builder-item-id")).toBe("form");
    expect(headings).toHaveLength(1);
    expect(heading?.getAttribute("data-builder-region")).toBe("newsletter.form.title");
    expect(heading?.id).toBe("newsletter-signup-title");
    expect(headingBlock?.nextElementSibling).toBe(formRegion);
    expect(html.match(/action="\/api\/forms\/newsletter-signup"/g)).toHaveLength(1);
    expect(html).toContain('data-builder-region="newsletter.form.eyebrow"');
    expect(html).toContain('data-builder-region="newsletter.form.title"');
    expect(html).toContain('data-builder-region="newsletter.form.body"');
    expect(html).not.toContain('data-builder-region="global.template.form-');
    expect(html).toContain('data-builder-region="newsletter.form"');
    expect(html).not.toContain('data-builder-instance="newsletter-hero"');
    expect(html).not.toContain('data-builder-instance="newsletter-supporting"');
    expect(firstSection?.querySelector(".public-form-card-eyebrow")).toBeNull();
    expect(firstSection?.querySelector("h3")).toBeNull();

    const namedForm = firstSection?.querySelector('[role="form"]');
    const nativeForm = firstSection?.querySelector("form");
    expect(firstSection?.querySelectorAll('[role="form"]')).toHaveLength(1);
    expect(namedForm?.getAttribute("aria-labelledby")).toBe(heading?.id);
    expect(nativeForm?.hasAttribute("aria-label")).toBe(false);
    expect(nativeForm?.hasAttribute("aria-labelledby")).toBe(false);
    expect(nativeForm?.querySelector("legend")?.textContent).toContain("District Newsletter");

    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.newsletter-first-copy h1\s*\{[^}]*font-size:\s*clamp\(2\.15rem,\s*5vw,\s*3\.6rem\)/);
    expect(css).toMatch(/\.newsletter-first-shell\s*\{[^}]*gap:\s*clamp\(1\.1rem,\s*3vw,\s*1\.75rem\)/);
  });

  it("names the truthful unavailable newsletter group from the compact page heading", async () => {
    mocks.configuration.mockReturnValue({
      status: "disabled",
      code: "newsletter_disabled",
      environment: "production"
    });
    const newsletter = getPageBySlug("newsletter");
    const html = renderToStaticMarkup(await PageTemplate({ page: newsletter! }));
    const document = new JSDOM(html).window.document as Document;
    const heading = document.querySelector("h1");
    const firstSection = document.querySelector('[data-builder-item-id="form"]');
    const group = firstSection?.querySelector('[role="group"]');

    expect(heading?.id).toBe("newsletter-signup-title");
    expect(group?.getAttribute("aria-labelledby")).toBe(heading?.id);
    expect(firstSection?.querySelector('[role="form"]')).toBeNull();
    expect(firstSection?.querySelector(".public-form-card-eyebrow")).toBeNull();
    expect(firstSection?.querySelector("h3")).toBeNull();
    expect(html).toContain("Call");
    expect(html).not.toContain("/api/forms/newsletter-signup");
  });

  it("states the pending confirmation boundary and links privacy before active signup", async () => {
    const html = renderToStaticMarkup(await ResidentForm({ type: "newsletter", locale: "es" }));

    expect(html).toContain('data-public-form-type="newsletter"');
    expect(html).toContain("Suscr\u00edbase al Bolet\u00edn del distrito");
    expect(html).toContain("Los campos marcados con * son obligatorios");
    expect(html).toContain("No estar\u00e1 suscrito hasta que confirme");
    expect(html).toContain("La verificaci\u00f3n se ejecuta autom\u00e1ticamente");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('action="/api/forms/newsletter-signup"');
    expect(html).not.toContain("You are now subscribed");
    expect(html).not.toContain("newsletter delivery is active");
  });

  it("presents Contact as a civic service card without changing its endpoint", async () => {
    const html = renderToStaticMarkup(await ResidentForm({ type: "contact", locale: "es" }));

    expect(html).toContain('data-public-form-type="contact"');
    expect(html).toContain("Servicio de la oficina del distrito");
    expect(html).toContain("Env\u00ede un mensaje a la oficina del distrito");
    expect(html).toContain("Los campos marcados con * son obligatorios");
    expect(html).toContain('action="/api/forms/contact"');
  });

  it("fails closed to district contact and exposes no form endpoint when unready", async () => {
    mocks.configuration.mockReturnValue({
      status: "disabled",
      code: "newsletter_disabled",
      environment: "production"
    });
    const html = renderToStaticMarkup(await ResidentForm({ type: "newsletter" }));

    expect(html).toContain('data-public-form-type="newsletter"');
    expect(html).toContain("Join the District Newsletter");
    expect(html).toContain("Call");
    expect(html).not.toContain("/api/forms/newsletter-signup");
    expect(html).not.toContain("Request updates");
  });

  it("publishes the approved privacy subjects without unsupported legal promises", () => {
    const html = renderToStaticMarkup(<PrivacyPageContent locale="en" />);

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

  it("renders the complete privacy notice in Spanish without English fallback copy", () => {
    const html = renderToStaticMarkup(<PrivacyPageContent locale="es" />);

    for (const text of [
      "Aviso de privacidad",
      "Información que recopilamos",
      "Cómo se utiliza la información del boletín",
      "Entrega de correo electrónico mediante Resend",
      "Opciones de confirmación y cancelación de suscripción",
      "Solicitudes de acceso, corrección y eliminación",
      "Enfoque de conservación",
    ]) expect(html).toContain(text);
    expect(html).not.toContain("Information we collect");
    expect(html).not.toContain("Open contact page");
  });
});
