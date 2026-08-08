import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FormsGuidanceWorkspace } from "../app/admin/editor/forms-guidance-workspace";
import {
  getManagedFormDefinition,
  isManagedPublicFormKey,
  loadManagedFormProjection
} from "../lib/builder/forms";

describe("managed public forms", () => {
  it("documents both live managed forms and their distinct record lifecycles", () => {
    const html = renderToStaticMarkup(createElement(FormsGuidanceWorkspace, {
      role: "owner",
      newsletterOperations: createElement("div", null, "Newsletter controls"),
    }));

    expect(html.match(/data-managed-form-card=/g)).toHaveLength(2);
    expect(html).toContain("Contact the District Office");
    expect(html).toContain("/contact");
    expect(html).toContain("First name, last name, subject, and message");
    expect(html).toContain("Operational contact consent");
    expect(html).toContain("Submission → identity/customer → eligible Lead → Overview");
    expect(html).toContain("District Newsletter");
    expect(html).toContain("/newsletter");
    expect(html).toContain("Email, optional first name, and required marketing email consent");
    expect(html).toContain("Pending confirmation → confirmed subscription → active subscriber");
    expect(html).toContain("Newsletter signup does not create a lead");
    expect(html).toContain("Open public form");
    expect(html).toContain("Review submissions");
  });

  it("provides a manual authentic-data checklist with no mutation automation or provider claim", () => {
    const html = renderToStaticMarkup(createElement(FormsGuidanceWorkspace, {
      role: "viewer",
      newsletterOperations: null,
    }));
    const checklist = html.slice(html.indexOf('id="authentic-live-form-checklist"'));

    expect(checklist).toContain("Controlled live-data checklist");
    expect(checklist).toContain("never fills or submits a form, seeds a record, or calls an email, SMS, or AI provider");
    expect(checklist).not.toContain("<form");
    expect(checklist).not.toContain("<input");
    expect(html).toContain("SMS and AI actions remain unavailable");
  });

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
