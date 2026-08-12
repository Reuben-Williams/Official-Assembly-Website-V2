"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { publicCopy } from "../i18n/catalog.public";
import type { PublicLocale } from "../i18n/locale";

export function LanguageToggle({ locale }: { locale: PublicLocale }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const target = locale === "en" ? "es" : "en";

  async function changeLanguage() {
    setPending(true);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: target }),
      });
      if (!response.ok) return;
      router.refresh();
      window.requestAnimationFrame(() => button.current?.focus());
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      aria-label={publicCopy(
        locale,
        target === "es" ? "global.language.change-to-es" : "global.language.change-to-en",
        target === "es" ? "View site in Spanish" : "View site in English",
      )}
      aria-pressed={locale === "es"}
      className="language-toggle"
      disabled={pending}
      lang={target}
      onClick={changeLanguage}
      ref={button}
      type="button"
    >
      <Languages size={18} aria-hidden="true" />
      <span>{publicCopy(
        locale,
        target === "es" ? "global.language.spanish" : "global.language.english",
        target === "es" ? "Español" : "English",
      )}</span>
    </button>
  );
}
