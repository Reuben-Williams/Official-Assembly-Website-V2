import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";

import { getImage } from "./data/site";
import { ImagePanel } from "./ui/ImagePanel";
import { localizedBuilderText } from "./i18n/catalog.server";
import type { PublicLocale } from "./i18n/locale";
import { readPublicLocale } from "./i18n/server";
import {
  builderLink,
  builderText,
  loadBuilderServerContent,
  type BuilderServerContent,
} from "../lib/builder/server-content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await readPublicLocale();
  return { title: locale === "es" ? "P\u00e1gina no encontrada" : "Page not found" };
}

function NotFoundPageView({ content, locale }: { content: BuilderServerContent; locale: PublicLocale }) {
  const image = { ...getImage("hero"), regionId: "404.hero.image" };
  const primaryCta = builderLink(content, "404.hero.primary-cta", {
    href: "/",
    label: "Return home",
  });
  const secondaryCta = builderLink(content, "404.hero.secondary-cta", {
    href: "/resources",
    label: "View resources",
  });

  return (
    <section className="hero" data-builder-content-path="/404">
      <div className="container hero-grid">
        <div>
          <p
            className="eyebrow"
            data-builder-kind="text"
            data-builder-region="404.hero.eyebrow"
          >
            {localizedBuilderText(locale, "404.hero.eyebrow", builderText(content, "404.hero.eyebrow", "Page not found"))}
          </p>
          <h1 data-builder-kind="text" data-builder-region="404.hero.title">
            {localizedBuilderText(locale, "404.hero.title", builderText(content, "404.hero.title", "We couldn't find that page."))}
          </h1>
          <p
            className="lead"
            data-builder-kind="text"
            data-builder-region="404.hero.body"
          >
            {localizedBuilderText(locale, "404.hero.body", builderText(
              content,
              "404.hero.body",
              "The page may have moved, or the address may be incorrect. Use one of the links below to continue.",
            ))}
          </p>
          <div className="hero-actions">
            <Link
              className="cta-link"
              data-builder-kind="link"
              data-builder-region="404.hero.primary-cta"
              href={primaryCta.href}
            >
              <span data-builder-link-label>{localizedBuilderText(locale, "404.hero.primary-cta.label", primaryCta.label)}</span>
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link
              className="secondary-link"
              data-builder-kind="link"
              data-builder-region="404.hero.secondary-cta"
              href={secondaryCta.href}
            >
              <span data-builder-link-label>{localizedBuilderText(locale, "404.hero.secondary-cta.label", secondaryCta.label)}</span>
            </Link>
          </div>
        </div>
        <ImagePanel
          asset={image}
          caption="District office media"
          instance="404-hero"
          priority
          variant="hero"
          content={content}
          locale={locale}
        />
      </div>
    </section>
  );
}

export default async function NotFoundPage() {
  await connection();
  const [content, locale] = await Promise.all([loadBuilderServerContent("/404"), readPublicLocale()]);
  return <NotFoundPageView content={content} locale={locale} />;
}
