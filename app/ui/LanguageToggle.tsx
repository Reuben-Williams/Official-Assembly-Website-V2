"use client";

import { useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";

import { type LanguageCode, translateStableText } from "../i18n/translations";

const storageKey = "assembly-language";

function applyLanguage(language: LanguageCode) {
  if (new URLSearchParams(window.location.search).get("builderPreview") === "1") {
    document.documentElement.lang = "en";
    return;
  }

  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n-key]")) {
    const key = element.dataset.i18nKey;
    if (!key) continue;
    const previousOutput = element.dataset.i18nOutput;
    const current = element.textContent ?? "";
    if (!element.dataset.i18nSource || (previousOutput !== undefined && current !== previousOutput)) {
      element.dataset.i18nSource = current;
    }
    const source = element.dataset.i18nSource ?? current;
    const output = translateStableText(key, source, language);
    if (current !== output) element.textContent = output;
    element.dataset.i18nOutput = output;
  }
  document.documentElement.lang = language;
}

export function LanguageToggle() {
  const [language, setLanguage] = useState<LanguageCode>("en");
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      if (window.localStorage.getItem(storageKey) === "es") {
        const frame = window.requestAnimationFrame(() => setLanguage("es"));
        return () => window.cancelAnimationFrame(frame);
      }
    }

    let scheduled = 0;
    const update = () => {
      window.cancelAnimationFrame(scheduled);
      scheduled = window.requestAnimationFrame(() => applyLanguage(language));
    };
    update();
    window.localStorage.setItem(storageKey, language);
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(scheduled);
    };
  }, [language]);

  return (
    <button
      aria-label={language === "en" ? "Translate site to Spanish" : "Show site in English"}
      className="language-toggle"
      data-no-translate
      onClick={() => setLanguage(language === "en" ? "es" : "en")}
      type="button"
    >
      <Languages size={18} aria-hidden="true" />
      <span>{language === "en" ? "Español" : "English"}</span>
    </button>
  );
}
