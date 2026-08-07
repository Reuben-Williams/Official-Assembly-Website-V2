import { describe, expect, it } from "vitest";
import { APPROVED_FORM_TEMPLATES, createPublicFormProjection } from "@reuben-williams/forms";

import {
  APPROVED_NEWSLETTER_CONSENT_LABEL,
  APPROVED_NEWSLETTER_SUCCESS_COPY,
  applyApprovedNewsletterConsentProjection,
  createPackageCompatibleNewsletterSubmissionRequest,
  newsletterPackageCompatibleConfiguration,
  newsletterManagedFormConfiguration
} from "../lib/newsletter/managed-form-revision";

describe("approved newsletter managed-form revision", () => {
  it("requires double opt-in consent and truthfully reports pending confirmation", () => {
    expect(newsletterManagedFormConfiguration).toMatchObject({
      templateId: "local-business.newsletter-signup",
      templateVersion: "1.0.0",
      consentPolicyVersion: "marketing-v1",
      qualification: { enabled: false, allowedZipCodes: [] },
      completion: {
        mode: "inline_success",
        successCopy: APPROVED_NEWSLETTER_SUCCESS_COPY
      }
    });
    expect(newsletterManagedFormConfiguration.fields).toEqual([
      expect.objectContaining({ key: "email", visible: true, required: true }),
      expect.objectContaining({ key: "firstName", visible: true, required: false }),
      expect.objectContaining({
        key: "marketingConsent",
        label: APPROVED_NEWSLETTER_CONSENT_LABEL,
        visible: true,
        required: true
      })
    ]);
    expect(APPROVED_NEWSLETTER_CONSENT_LABEL).toBe(
      "I agree to receive District Newsletter emails from the Office of Assemblywoman Carmen Morales. I understand that submitting this form is a confirmation request, that I am not subscribed until I confirm by email, and that I can unsubscribe at any time."
    );
    expect(APPROVED_NEWSLETTER_SUCCESS_COPY).toBe(
      "Check your inbox to continue. Your request is pending, and you are not subscribed unless you complete the confirmation step."
    );

    const template = APPROVED_FORM_TEMPLATES.find((candidate) =>
      candidate.id === "local-business.newsletter-signup" && candidate.version === "1.0.0"
    )!;
    const packageProjection = createPublicFormProjection(
      template,
      newsletterPackageCompatibleConfiguration(newsletterManagedFormConfiguration),
      {
        businessName: "Office of Assemblywoman Carmen Theresa Morales",
        optionSources: {},
        approvedRedirectPaths: ["/newsletter"]
      }
    );
    const publicProjection = applyApprovedNewsletterConsentProjection(packageProjection);
    expect(publicProjection.fields.find((field) => field.kind === "consent")?.label)
      .toBe(APPROVED_NEWSLETTER_CONSENT_LABEL);
    expect(publicProjection.consent.renderedText).toBe(APPROVED_NEWSLETTER_CONSENT_LABEL);
  });

  it("accepts only the displayed disclosure before adapting to the package validator", async () => {
    const template = APPROVED_FORM_TEMPLATES.find((candidate) =>
      candidate.id === "local-business.newsletter-signup" && candidate.version === "1.0.0"
    )!;
    const request = new Request("https://www.assemblywomanmorales.com/api/forms/newsletter-signup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://www.assemblywomanmorales.com" },
      body: JSON.stringify({ renderedConsentText: APPROVED_NEWSLETTER_CONSENT_LABEL })
    });
    const adapted = await createPackageCompatibleNewsletterSubmissionRequest({
      request,
      template,
      businessName: "Office of Assemblywoman Carmen Theresa Morales"
    });
    const body = await adapted.json() as Record<string, unknown>;
    expect(body.renderedConsentText).toBe(
      "I agree to receive marketing emails from Office of Assemblywoman Carmen Theresa Morales. I can unsubscribe at any time."
    );

    await expect(createPackageCompatibleNewsletterSubmissionRequest({
      request: new Request(request.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ renderedConsentText: "Generic consent" })
      }),
      template,
      businessName: "Office of Assemblywoman Carmen Theresa Morales"
    })).rejects.toBeInstanceOf(TypeError);
  });
});
