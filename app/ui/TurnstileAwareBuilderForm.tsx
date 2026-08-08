"use client";

import { useState, type FormEvent } from "react";
import {
  BuilderForm,
  type BuilderFormProps
} from "@reuben-williams/next/forms";

const VERIFICATION_GUIDANCE =
  "Verification runs automatically. Wait for it to finish before submitting.";

const VERIFICATION_REQUIRED =
  "Verification is still loading. Wait a moment, then submit again.";

export function TurnstileAwareBuilderForm(props: BuilderFormProps) {
  const [verificationMessage, setVerificationMessage] = useState(VERIFICATION_GUIDANCE);

  function requireTurnstileToken(event: FormEvent<HTMLDivElement>) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const token = new FormData(form).get("cf-turnstile-response");
    if (typeof token === "string" && token.length > 0) {
      setVerificationMessage("");
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setVerificationMessage(VERIFICATION_REQUIRED);
  }

  return (
    <div onSubmitCapture={requireTurnstileToken} data-turnstile-submission-guard="true">
      <BuilderForm {...props} />
      <p role="status" aria-live="polite" data-turnstile-status="true">
        {verificationMessage}
      </p>
    </div>
  );
}
