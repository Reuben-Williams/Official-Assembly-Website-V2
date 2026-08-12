// @vitest-environment jsdom

import { act } from "react";
import { useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type MockProjection = {
  formKey: string;
  revisionId: string;
  displayName: string;
  fields: Array<{
    key: string;
    label: string;
    helpText: string;
    placeholder: string;
    kind: "text" | "email" | "consent";
    required: boolean;
  }>;
  consent: {
    fieldKey: string;
    policyVersion: string;
    renderedText: string;
  };
  completion: { mode: "inline_success" };
  turnstile: { siteKey: string; action: string };
};

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  projection: undefined as MockProjection | undefined,
  completeSuccess: undefined as (() => void) | undefined,
  completeError: undefined as (() => void) | undefined
}));

vi.mock("@reuben-williams/next/forms", () => ({
  BuilderForm: ({ projection, endpoint, className }: {
    projection: MockProjection;
    endpoint: string;
    className?: string;
  }) => {
    const formRef = useRef<HTMLFormElement>(null);
    const [status, setStatus] = useState("");
    const [submitting, setSubmitting] = useState(false);
    mocks.projection = projection;
    mocks.completeSuccess = () => {
      setStatus("Thanks. We received your request.");
      formRef.current?.reset();
      setSubmitting(false);
    };
    mocks.completeError = () => {
      setStatus("We could not submit the form. Please try again.");
      setSubmitting(false);
    };

    return (
      <form
        ref={formRef}
        className={className}
        action={endpoint}
        data-builder-form-key={projection.formKey}
        onSubmit={(event) => {
          event.preventDefault();
          mocks.submit();
          setStatus("Submitting your request.");
          setSubmitting(true);
        }}
      >
        <fieldset>
          <legend>{projection.displayName}</legend>
          {projection.fields.map((field) => {
            const id = `builder-form-${projection.formKey}-${field.key}`;
            const errorId = `${id}-error`;
            return (
              <div key={field.key} data-builder-form-field={field.key}>
                <label htmlFor={id}>
                  {field.kind === "consent" ? (
                    <>
                      <input id={id} name={field.key} type="checkbox" required={field.required} aria-describedby={errorId} />
                      <span>{field.label}</span>
                    </>
                  ) : (
                    <>{field.label}{field.required ? " *" : ""}</>
                  )}
                </label>
                {field.kind !== "consent" ? (
                  <input
                    id={id}
                    name={field.key}
                    type={field.kind === "email" ? "email" : "text"}
                    required={field.required}
                    aria-describedby={errorId}
                  />
                ) : null}
                <span id={errorId} aria-live="polite" />
              </div>
            );
          })}
        </fieldset>
        <input type="hidden" name="cf-turnstile-response" defaultValue="" />
        <button type="submit" disabled={submitting}>{submitting ? "Submitting" : "Submit"}</button>
        <p data-builder-form-status="true" role="status" aria-live="polite">{status}</p>
      </form>
    );
  }
}));

import { TurnstileAwareBuilderForm } from "../app/ui/TurnstileAwareBuilderForm";

const contactProjection: MockProjection = {
  formKey: "contact",
  revisionId: "30000000-0000-4000-8000-000000000001",
  displayName: "Contact",
  fields: [
    {
      key: "firstName",
      label: "First name",
      helpText: "",
      placeholder: "First name",
      kind: "text",
      required: true
    },
    {
      key: "email",
      label: "Email",
      helpText: "",
      placeholder: "you@example.com",
      kind: "email",
      required: false
    },
    {
      key: "operationalConsent",
      label: "I agree that the District Office may contact me about this request.",
      helpText: "",
      placeholder: "",
      kind: "consent",
      required: true
    }
  ],
  consent: {
    fieldKey: "operationalConsent",
    policyVersion: "operational-v1",
    renderedText: "Approved operational consent"
  },
  completion: { mode: "inline_success" },
  turnstile: { siteKey: "site-key", action: "contact" }
};

const newsletterProjection: MockProjection = {
  ...contactProjection,
  formKey: "newsletter-signup",
  displayName: "District Newsletter",
  fields: [
    {
      key: "email",
      label: "Email address",
      helpText: "",
      placeholder: "you@example.com",
      kind: "email",
      required: true
    },
    {
      key: "firstName",
      label: "First name",
      helpText: "",
      placeholder: "First name",
      kind: "text",
      required: false
    },
    {
      key: "marketingConsent",
      label: "I agree to receive District Newsletter emails.",
      helpText: "",
      placeholder: "",
      kind: "consent",
      required: true
    }
  ],
  consent: {
    fieldKey: "marketingConsent",
    policyVersion: "marketing-v1",
    renderedText: "Approved marketing consent"
  },
  turnstile: { siteKey: "site-key", action: "newsletter" }
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.submit.mockReset();
  mocks.projection = undefined;
  mocks.completeSuccess = undefined;
  mocks.completeError = undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function renderForm(
  variant: "contact" | "newsletter" = "contact",
  projection: MockProjection = variant === "contact" ? contactProjection : newsletterProjection
) {
  await act(async () => root.render(
    <TurnstileAwareBuilderForm
      endpoint={`/api/forms/${projection.formKey}`}
      projection={projection as never}
      variant={variant}
    />
  ));
  return host.querySelector("form")!;
}

function setReportValidity(form: HTMLFormElement, value: boolean) {
  const reportValidity = vi.fn(() => value);
  Object.defineProperty(form, "reportValidity", { configurable: true, value: reportValidity });
  return reportValidity;
}

async function dispatchSubmit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function flushObserver() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("TurnstileAwareBuilderForm", () => {
  it("creates a display-only projection with civic heading and field indicators", async () => {
    await renderForm("contact");

    expect(mocks.projection?.displayName).toBe("Send a message to the District Office");
    expect(mocks.projection?.fields.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "firstName", label: "First name" },
      { key: "email", label: "Email — Optional" },
      {
        key: "operationalConsent",
        label: "I agree that the District Office may contact me about this request. *"
      }
    ]);
    expect(mocks.projection).toMatchObject({
      formKey: contactProjection.formKey,
      revisionId: contactProjection.revisionId,
      consent: contactProjection.consent,
      completion: contactProjection.completion,
      turnstile: contactProjection.turnstile
    });
    expect(contactProjection.displayName).toBe("Contact");
    expect(contactProjection.fields[1]?.label).toBe("Email");
  });

  it("shows field validation before checking for a Turnstile token", async () => {
    const form = await renderForm();
    const firstName = host.querySelector<HTMLInputElement>('[name="firstName"]')!;
    const reportValidity = setReportValidity(form, false);
    Object.defineProperty(firstName, "validationMessage", {
      configurable: true,
      value: "Please fill out this field."
    });
    Object.defineProperty(firstName, "validity", {
      configurable: true,
      value: { valid: false, valueMissing: true }
    });
    reportValidity.mockImplementation(() => {
      firstName.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
      return false;
    });

    await dispatchSubmit(form);

    expect(reportValidity).toHaveBeenCalledOnce();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(host.querySelector("[data-public-form-state]")?.getAttribute("data-public-form-state"))
      .toBe("client-invalid");
    expect(host.querySelector("#builder-form-contact-firstName-error")?.textContent)
      .toBe("Enter your first name.");
    expect(document.activeElement).toBe(firstName);
    expect(host.querySelector("[data-turnstile-status]")?.textContent)
      .not.toContain("Verification is still loading");
  });

  it("blocks a valid form until Turnstile has produced a token", async () => {
    const form = await renderForm();
    setReportValidity(form, true);

    await dispatchSubmit(form);

    expect(mocks.submit).not.toHaveBeenCalled();
    expect(host.querySelector("[data-public-form-state]")?.getAttribute("data-public-form-state"))
      .toBe("verification-needed");
    expect(host.querySelector("[data-turnstile-status]")?.textContent)
      .toContain("Verification is still loading");
  });

  it("passes a valid verified submission to the managed form unchanged", async () => {
    const form = await renderForm();
    setReportValidity(form, true);
    host.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')!.value = "verified-token";

    await dispatchSubmit(form);

    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-public-form-state]")?.getAttribute("data-public-form-state"))
      .toBe("submitting");
  });

  it("derives inline success from the managed form reset and shows newsletter delivery guidance", async () => {
    const form = await renderForm("newsletter");
    setReportValidity(form, true);
    host.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')!.value = "verified-token";
    await dispatchSubmit(form);

    await act(async () => mocks.completeSuccess?.());
    await flushObserver();

    expect(host.querySelector("[data-public-form-state]")?.getAttribute("data-public-form-state"))
      .toBe("success");
    expect(host.querySelector("[data-newsletter-success-guidance]")?.textContent)
      .toContain("may take several minutes");
    expect(host.querySelector("[data-newsletter-success-guidance]")?.textContent)
      .toContain("spam or junk");
    expect(host.textContent).not.toContain("You are now subscribed");
  });

  it("derives a managed form error when completion occurs without a reset", async () => {
    const form = await renderForm();
    setReportValidity(form, true);
    host.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')!.value = "verified-token";
    await dispatchSubmit(form);

    await act(async () => mocks.completeError?.());
    await flushObserver();

    expect(host.querySelector("[data-public-form-state]")?.getAttribute("data-public-form-state"))
      .toBe("error");
    expect(host.querySelector("[data-builder-form-status]")?.textContent)
      .toContain("could not submit");
  });

  it("clears field feedback after the resident corrects the field", async () => {
    await renderForm();
    const firstName = host.querySelector<HTMLInputElement>('[name="firstName"]')!;
    const error = host.querySelector("#builder-form-contact-firstName-error")!;
    Object.defineProperty(firstName, "validity", {
      configurable: true,
      value: { valid: false, valueMissing: true }
    });

    await act(async () => {
      firstName.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
    });
    expect(error.textContent).toBe("Enter your first name.");

    Object.defineProperty(firstName, "validity", {
      configurable: true,
      value: { valid: true, valueMissing: false }
    });
    firstName.value = "Carmen";
    await act(async () => {
      firstName.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(error.textContent).toBe("");
  });
});
