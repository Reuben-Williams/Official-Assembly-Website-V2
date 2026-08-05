import { describe, expect, it } from "vitest";

import {
  getManagedFormDefinition,
  isManagedPublicFormKey,
  loadManagedFormProjection
} from "../lib/builder/forms";

describe("managed public forms", () => {
  it("maps only the two approved form templates", () => {
    expect(getManagedFormDefinition("contact")).toMatchObject({
      formKey: "contact",
      templateId: "local-business.contact",
      templateVersion: "1.0.0"
    });
    expect(getManagedFormDefinition("newsletter")).toMatchObject({
      formKey: "newsletter-signup",
      templateId: "local-business.newsletter-signup",
      templateVersion: "1.0.0",
      requiresMarketingConsent: true
    });
    expect(getManagedFormDefinition("survey")).toBeNull();
    expect(isManagedPublicFormKey("survey")).toBe(false);
  });

  it("keeps an unavailable database truthful instead of fabricating success", async () => {
    const result = await loadManagedFormProjection("contact", {
      repository: {
        getPublishedForm: async () => {
          throw new Error("database unavailable");
        }
      }
    });

    expect(result).toEqual({ status: "unavailable", reason: "FORM_DATA_UNAVAILABLE" });
  });

  it("marks the survey as unsupported without calling a repository", async () => {
    let called = false;
    const result = await loadManagedFormProjection("survey", {
      repository: {
        getPublishedForm: async () => {
          called = true;
          return null;
        }
      }
    });

    expect(result).toEqual({ status: "unsupported", reason: "UNAPPROVED_TEMPLATE" });
    expect(called).toBe(false);
  });
});
