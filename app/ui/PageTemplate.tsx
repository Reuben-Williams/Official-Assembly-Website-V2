import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { getImage, siteConfig, type PageContent } from "../data/site";
import { Cards } from "./Cards";
import { ResidentForm } from "./ResidentForms";
import { ImagePanel } from "./ImagePanel";
import { NewsletterPageView } from "./NewsletterPageView";
import { CurrentResourceSection, VolunteerPortalSection } from "./ConstituentActionSections";
import {
  builderLink,
  builderText,
  type BuilderServerContent,
} from "../../lib/builder/server-content";
import { localizedBuilderText } from "../i18n/catalog.server";
import type { PublicLocale } from "../i18n/locale";

type PageTemplateProps = {
  page: PageContent;
  content?: BuilderServerContent;
  locale?: PublicLocale;
};

const EMPTY_CONTENT: BuilderServerContent = { regions: {} };

export async function PageTemplate({ page, content = EMPTY_CONTENT, locale = "en" }: PageTemplateProps) {
  const slug = page.slug ?? "home";
  if (slug === "newsletter") {
    return NewsletterPageView({ page, content, locale });
  }
  const formType =
    slug === "contact" || slug === "newsletter" || slug === "survey" ? slug : null;
  const formCopyRegions = formType
    ? {
        eyebrow: `${slug}.form.eyebrow`,
        title: `${slug}.form.title`,
        body: `${slug}.form.body`,
      }
    : null;
  const supportingImage = {
    news: "professional-news-supporting",
    resources: "professional-resources-supporting",
    community: "graduation",
  }[slug] ?? "coverage";
  const residentForm = formType && formType !== "newsletter"
    ? await ResidentForm({ type: formType, locale })
    : null;
  const primaryCta = builderLink(content, `${slug}.hero.primary-cta`, {
    href: "/contact",
    label: "Contact the Office",
  });
  const secondaryCta = builderLink(content, `${slug}.hero.secondary-cta`, {
    href: "/newsletter",
    label: "Get Updates",
  });

  return (
    <div data-builder-region={`${slug}.sections`} data-builder-kind="sections">
      <section className="hero" data-builder-item-id="hero">
        <div className="container hero-grid">
          <div>
            <p
              className="eyebrow"
              data-builder-region={`${slug}.hero.eyebrow`}
              data-builder-kind="text"
              data-i18n-key={`${slug}.hero.eyebrow`}
            >
              {localizedBuilderText(locale, `${slug}.hero.eyebrow`, builderText(content, `${slug}.hero.eyebrow`, page.eyebrow))}
            </p>
            <h1
              data-builder-region={`${slug}.hero.title`}
              data-builder-kind="text"
              data-i18n-key={`${slug}.hero.title`}
            >
              {localizedBuilderText(locale, `${slug}.hero.title`, builderText(content, `${slug}.hero.title`, page.title))}
            </h1>
            <p
              className="lead"
              data-builder-region={`${slug}.hero.body`}
              data-builder-kind="text"
              data-i18n-key={`${slug}.hero.body`}
            >
              {localizedBuilderText(locale, `${slug}.hero.body`, builderText(content, `${slug}.hero.body`, page.description))}
            </p>
            <div className="hero-actions">
              <Link
                className="cta-link"
                data-builder-region={`${slug}.hero.primary-cta`}
                data-builder-kind="link"
                href={primaryCta.href}
              >
                <span data-builder-link-label>{localizedBuilderText(locale, `${slug}.hero.primary-cta.label`, primaryCta.label)}</span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link
                className="secondary-link"
                data-builder-region={`${slug}.hero.secondary-cta`}
                data-builder-kind="link"
                href={secondaryCta.href}
              >
                <span data-builder-link-label>{localizedBuilderText(locale, `${slug}.hero.secondary-cta.label`, secondaryCta.label)}</span>
              </Link>
            </div>
          </div>
          <ImagePanel
            asset={getImage(page.imageKey)}
            caption="District office media"
            instance={`${slug}-hero`}
            priority
            variant="hero"
            content={content}
            locale={locale}
          />
        </div>
      </section>

      {slug === "resources" ? <CurrentResourceSection content={content} locale={locale} /> : null}
      {slug === "community" ? <VolunteerPortalSection content={content} locale={locale} /> : null}

      <section className="section" data-builder-item-id="features">
        <div className="container">
          <div className="section-heading">
            <div>
              <p
                className="eyebrow"
                data-builder-region={`${slug}.features.eyebrow`}
                data-builder-kind="text"
              >
                {localizedBuilderText(locale, `${slug}.features.eyebrow`, builderText(content, `${slug}.features.eyebrow`, "Page Resources"))}
              </p>
              <h2
                data-builder-region={`${slug}.features.title`}
                data-builder-kind="text"
              >
                {localizedBuilderText(locale, `${slug}.features.title`, builderText(
                  content,
                  `${slug}.features.title`,
                  "Verified paths for District 34 residents",
                ))}
              </h2>
            </div>
            <p
              data-builder-region={`${slug}.features.body`}
              data-builder-kind="text"
            >
              {localizedBuilderText(locale, `${slug}.features.body`, builderText(
                content,
                `${slug}.features.body`,
                `Use these links for current public information or contact the district office at ${siteConfig.phoneDisplay}.`,
              ))}
            </p>
          </div>
          <Cards
            cards={page.cards}
            content={content}
            featuredFirst={slug === "contact"}
            fixedOrder={slug === "voting"}
            safePublicLinks={slug === "voting"}
            regionId={`${slug}.cards`}
            locale={locale}
          />
        </div>
      </section>

      {formType ? (
        <section className="section section-muted" data-builder-item-id="form">
          <div className="container split">
            <div>
              <p
                className="eyebrow"
                data-builder-region={formCopyRegions!.eyebrow}
                data-builder-kind="text"
              >
                {localizedBuilderText(locale, formCopyRegions!.eyebrow, builderText(
                  content,
                  formCopyRegions!.eyebrow,
                  "Resident Form",
                ))}
              </p>
              <h2
                data-builder-region={formCopyRegions!.title}
                data-builder-kind="text"
              >
                {localizedBuilderText(locale, formCopyRegions!.title, builderText(
                  content,
                  formCopyRegions!.title,
                  "District office intake",
                ))}
              </h2>
              <p
                className="lead"
                data-builder-region={formCopyRegions!.body}
                data-builder-kind="text"
              >
                {localizedBuilderText(locale, formCopyRegions!.body, builderText(
                  content,
                  formCopyRegions!.body,
                  "Online submission is shown only when an approved form revision and verification service are available.",
                ))}
              </p>
            </div>
            <div
              data-builder-region={formType === "survey" ? undefined : `${slug}.form`}
              data-builder-kind={formType === "survey" ? undefined : "sections"}
              data-builder-item-id="managed-form"
            >
              {residentForm}
            </div>
          </div>
        </section>
      ) : null}

      <section className="section section-muted" data-builder-item-id="supporting">
        <div className="container split">
          <ImagePanel
            asset={getImage(supportingImage)}
            caption="Additional district media"
            instance={`${slug}-supporting`}
            content={content}
            locale={locale}
          />
          <div className="timeline">
            <div className="timeline-item">
              <CheckCircle2 color="var(--accent)" aria-hidden="true" />
              <div>
                <strong>{localizedBuilderText(locale, `${slug}.supporting.official.title`, "Official sources first")}</strong>
                <p>{localizedBuilderText(locale, `${slug}.supporting.official.body`, "State services, voting details, and legislative records link to current government sources.")}</p>
              </div>
            </div>
            <div className="timeline-item">
              <CheckCircle2 color="var(--accent)" aria-hidden="true" />
              <div>
                <strong>{localizedBuilderText(locale, `${slug}.supporting.office.title`, "District office access")}</strong>
                <p>{localizedBuilderText(locale, `${slug}.supporting.office.body`, `Residents can call ${siteConfig.phoneDisplay} when online intake is unavailable.`)}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {page.secondaryCards?.length ? (
        <section className="section" data-builder-item-id="secondary">
          <div className="container">
            <Cards
              cards={page.secondaryCards}
              columns="two"
              instance="secondary"
              regionId={`${slug}.cards`}
              content={content}
              locale={locale}
              fixedOrder={slug === "voting"}
              safePublicLinks={slug === "voting"}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
