"use client";

import { useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";

import { type LanguageCode, translateText } from "../i18n/translations";

const storageKey = "assembly-language";

function isTranslatableTextNode(node: Node) {
  if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) {
    return false;
  }

  const parent = node.parentElement;
  if (!parent) {
    return false;
  }

  return !parent.closest(
    "script, style, noscript, svg, code, pre, [data-no-translate]"
  );
}

function applyLanguage(language: LanguageCode, originalText: WeakMap<Text, string>) {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return isTranslatableTextNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    }
  );

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of nodes) {
    if (!originalText.has(node)) {
      originalText.set(node, node.nodeValue ?? "");
    }

    const source = originalText.get(node) ?? "";
    node.nodeValue = language === "en" ? source : translateText(source, "es");
  }

  document.documentElement.lang = language;
}

export function LanguageToggle() {
  const [language, setLanguage] = useState<LanguageCode>("en");
  const originalText = useRef(new WeakMap<Text, string>());
  const checkedSavedLanguage = useRef(false);

  useEffect(() => {
    if (!checkedSavedLanguage.current) {
      checkedSavedLanguage.current = true;
      const saved = window.localStorage.getItem(storageKey);

      if (saved === "es" && language !== "es") {
        const frame = window.requestAnimationFrame(() => setLanguage("es"));
        return () => window.cancelAnimationFrame(frame);
      }
    }

    applyLanguage(language, originalText.current);
    window.localStorage.setItem(storageKey, language);

    const observer = new MutationObserver(() => {
      applyLanguage(language, originalText.current);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return () => observer.disconnect();
  }, [language]);

  const nextLanguage = language === "en" ? "es" : "en";

  return (
    <button
      aria-label={language === "en" ? "Translate site to Spanish" : "Show site in English"}
      className="language-toggle"
      data-no-translate
      onClick={() => setLanguage(nextLanguage)}
      type="button"
    >
      <Languages size={18} aria-hidden="true" />
      <span>{language === "en" ? "Español" : "English"}</span>
    </button>
  );
}
