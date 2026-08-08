"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  BuilderForm,
  type BuilderFormProps
} from "@reuben-williams/next/forms";

const VERIFICATION_GUIDANCE =
  "Verification runs automatically. Wait for it to finish before submitting.";

const VERIFICATION_REQUIRED =
  "Verification is still loading. Wait a moment, then submit again.";

const NEWSLETTER_SUCCESS_GUIDANCE =
  "Your confirmation email may take several minutes to arrive. Check your spam or junk folder if it is not visible.";

const FORM_HEADINGS = Object.freeze({
  contact: "Send a message to the District Office",
  newsletter: "Join the District Newsletter"
});

type PublicFormVariant = keyof typeof FORM_HEADINGS;
type PublicFormState =
  | "idle"
  | "client-invalid"
  | "verification-needed"
  | "submitting"
  | "success"
  | "error";

type TurnstileAwareBuilderFormProps = BuilderFormProps & {
  readonly variant: PublicFormVariant;
};

function presentationLabel(field: BuilderFormProps["projection"]["fields"][number]) {
  if (!field.required) return `${field.label} — Optional`;
  if (field.kind === "consent") return `${field.label} *`;
  return field.label;
}

function createPresentationProjection(
  projection: BuilderFormProps["projection"],
  variant: PublicFormVariant
): BuilderFormProps["projection"] {
  return {
    ...projection,
    displayName: FORM_HEADINGS[variant],
    fields: projection.fields.map((field) => ({
      ...field,
      label: presentationLabel(field)
    }))
  };
}

function formControl(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    ? target
    : null;
}

function errorNodeFor(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const errorId = ids.find((id) => id.endsWith("-error"));
  return errorId ? document.getElementById(errorId) : null;
}

function invalidMessage(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  if (control.validity.typeMismatch && control instanceof HTMLInputElement && control.type === "email") {
    return "Enter a valid email address.";
  }
  if (control.validity.valueMissing) {
    const requiredMessages: Record<string, string> = {
      email: "Enter your email address.",
      firstName: "Enter your first name.",
      lastName: "Enter your last name.",
      marketingConsent: "Agree to receive District Newsletter emails before submitting.",
      message: "Enter a message.",
      operationalConsent: "Agree to the contact acknowledgement before submitting.",
      subject: "Enter a subject."
    };
    return requiredMessages[control.name] ?? "Complete this required field.";
  }
  return control.validationMessage || "Review this field and try again.";
}

function clearFieldErrors(form: HTMLFormElement) {
  for (const node of form.querySelectorAll<HTMLElement>('[id$="-error"]')) {
    node.textContent = "";
  }
}

export function TurnstileAwareBuilderForm({
  variant,
  projection,
  ...props
}: TurnstileAwareBuilderFormProps) {
  const [verificationMessage, setVerificationMessage] = useState(VERIFICATION_GUIDANCE);
  const [formState, setFormState] = useState<PublicFormState>("idle");
  const hostRef = useRef<HTMLDivElement>(null);
  const formStateRef = useRef<PublicFormState>("idle");
  const resetSeenRef = useRef(false);
  const pendingStatusRef = useRef<string | null>(null);
  const observedDisabledRef = useRef(false);
  const presentationProjection = useMemo(
    () => createPresentationProjection(projection, variant),
    [projection, variant]
  );

  function updateFormState(next: PublicFormState) {
    formStateRef.current = next;
    setFormState(next);
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    function observeManagedState() {
      if (formStateRef.current !== "submitting") return;
      const form = host!.querySelector<HTMLFormElement>("form");
      const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      const status = form?.querySelector<HTMLElement>("[data-builder-form-status]");
      if (!form || !submit || !status) return;

      if (submit.disabled) {
        observedDisabledRef.current = true;
        pendingStatusRef.current = status.textContent ?? "";
        return;
      }

      if (
        observedDisabledRef.current
        && !resetSeenRef.current
        && pendingStatusRef.current !== null
        && (status.textContent ?? "") !== pendingStatusRef.current
      ) {
        updateFormState("error");
      }
    }

    const observer = new MutationObserver(observeManagedState);
    observer.observe(host, {
      attributes: true,
      attributeFilter: ["disabled"],
      childList: true,
      characterData: true,
      subtree: true
    });
    return () => observer.disconnect();
  }, []);

  function showInvalidField(event: FormEvent<HTMLDivElement>) {
    const control = formControl(event.target);
    if (!control) return;
    event.preventDefault();
    const error = errorNodeFor(control);
    if (error) error.textContent = invalidMessage(control);
    updateFormState("client-invalid");
  }

  function clearCorrectedField(event: FormEvent<HTMLDivElement>) {
    const control = formControl(event.target);
    if (!control || !control.validity.valid) return;
    const error = errorNodeFor(control);
    if (error) error.textContent = "";
  }

  function guardSubmission(event: FormEvent<HTMLDivElement>) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (!form.reportValidity()) {
      event.preventDefault();
      event.stopPropagation();
      updateFormState("client-invalid");
      form.querySelector<HTMLElement>("input:invalid, textarea:invalid, select:invalid")
        ?.focus({ preventScroll: true });
      return;
    }

    const token = new FormData(form).get("cf-turnstile-response");
    if (typeof token !== "string" || token.length < 1) {
      event.preventDefault();
      event.stopPropagation();
      updateFormState("verification-needed");
      setVerificationMessage(VERIFICATION_REQUIRED);
      return;
    }

    resetSeenRef.current = false;
    pendingStatusRef.current = null;
    observedDisabledRef.current = false;
    updateFormState("submitting");
    setVerificationMessage("");
  }

  function recordSuccess(event: FormEvent<HTMLDivElement>) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || formStateRef.current !== "submitting") return;
    resetSeenRef.current = true;
    clearFieldErrors(form);
    updateFormState("success");
  }

  return (
    <div
      ref={hostRef}
      className="public-form-interaction"
      data-public-form-state={formState}
      data-turnstile-submission-guard="true"
      onInvalidCapture={showInvalidField}
      onInputCapture={clearCorrectedField}
      onResetCapture={recordSuccess}
      onSubmitCapture={guardSubmission}
    >
      <BuilderForm {...props} projection={presentationProjection} />
      <p role="status" aria-live="polite" data-turnstile-status="true">
        {verificationMessage}
      </p>
      {variant === "newsletter" && formState === "success" ? (
        <p className="newsletter-success-guidance" data-newsletter-success-guidance="true">
          {NEWSLETTER_SUCCESS_GUIDANCE}
        </p>
      ) : null}
    </div>
  );
}
