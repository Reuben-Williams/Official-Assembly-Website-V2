"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

type VerificationApi = {
  render(element: HTMLElement, options: Record<string, unknown>): string | undefined;
  remove(id: string): void;
};
type VerificationWindow = Window & { turnstile?: VerificationApi };
type VerificationState = "loading" | "ready" | "failed" | "expired";
const scriptLoads = new WeakMap<Document, Promise<VerificationApi>>();

function loadVerification(document: Document): Promise<VerificationApi> {
  const current = (document.defaultView as VerificationWindow).turnstile;
  if (current) return Promise.resolve(current);
  const existing = scriptLoads.get(document);
  if (existing) return existing;
  const pending = new Promise<VerificationApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.dataset.formVerification = "true";
    const timeout = setTimeout(failed, 15_000);
    function failed() {
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      script.remove();
      scriptLoads.delete(document);
      reject(new Error("Verification script unavailable"));
    }
    script.onerror = failed;
    script.onload = () => {
      const api = (document.defaultView as VerificationWindow).turnstile;
      if (!api) { failed(); return; }
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      resolve(api);
    };
    document.head.append(script);
  });
  scriptLoads.set(document, pending);
  return pending;
}

/** One widget per mounted form; navigation and retries never remount its fields. */
export function useFormVerification(host: RefObject<HTMLDivElement | null>, siteKey: string, action: string, locale: string) {
  const [state, setState] = useState<VerificationState>("loading");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState("loading");
    setAttempt(value => value + 1);
  }, []);

  useEffect(() => {
    const container = host.current?.querySelector<HTMLElement>(".cf-turnstile");
    if (!container) return;
    let disposed = false;
    let api: VerificationApi | undefined;
    let widget: string | undefined;
    function clearToken() {
      for (const input of container!.querySelectorAll<HTMLInputElement>('[name="cf-turnstile-response"]')) input.value = "";
    }
    function failure(next: VerificationState = "failed") {
      if (disposed) return;
      clearTimeout(timeout);
      clearToken();
      setState(next);
    }
    const timeout = setTimeout(() => failure(), 45_000);
    void loadVerification(container.ownerDocument).then(loaded => {
      if (disposed) return;
      api = loaded;
      widget = api.render(container, {
        sitekey: siteKey, action, language: locale, theme: "light", size: "flexible",
        callback: () => { if (!disposed) { clearTimeout(timeout); setState("ready"); } },
        "error-callback": () => { failure(); return true; },
        "expired-callback": () => failure("expired"),
        "timeout-callback": () => failure(),
      });
      if (!widget) failure();
    }).catch(() => failure());
    return () => {
      disposed = true;
      clearTimeout(timeout);
      clearToken();
      if (api && widget) api.remove(widget);
    };
  }, [action, attempt, host, locale, siteKey]);

  return { state, retry };
}
