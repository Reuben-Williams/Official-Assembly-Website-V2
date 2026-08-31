import { CheckCircle2 } from "lucide-react";

import { siteConfig, type PageContent } from "../data/site";
import { localizedBuilderText } from "../i18n/catalog.server";
import type { PublicLocale } from "../i18n/locale";
import {
  builderSectionIds,
  builderText,
  type BuilderServerContent,
} from "../../lib/builder/server-content";
import { normalizeNewsletterSectionIds } from "../../lib/builder/newsletter-layout";
import { Cards } from "./Cards";
import { ResidentForm } from "./ResidentForms";

type NewsletterPageViewProps = Readonly<{
  page: PageContent;
  content: BuilderServerContent;
  locale: PublicLocale;
}>;

const NEWSLETTER_HEADING_ID = "newsletter-signup-title";
const FALLBACK_SECTIONS = ["form", "features", "supporting"] as const;

export async function NewsletterPageView({
  page,
  content,
  locale,
}: NewsletterPageViewProps) {
  const configuredSections = builderSectionIds(
    content,
    "newsletter.sections",
    FALLBACK_SECTIONS,
  );
  const sectionIds = normalizeNewsletterSectionIds(
    configuredSections,
    Boolean(page.secondaryCards?.length),
  );
  const residentForm = await ResidentForm({
    type: "newsletter",
    locale,
    presentation: "newsletter-page-first",
    labelledBy: NEWSLETTER_HEADING_ID,
  });

  const sections = {
    form: (
      <section className="section newsletter-first-section" data-builder-item-id="form" key="form">
        <div className="container newsletter-first-shell">
          <div className="newsletter-first-copy">
            <p
              className="eyebrow"
              data-builder-region="newsletter.form.eyebrow"
              data-builder-kind="text"
            >
              {localizedBuilderText(locale, "newsletter.form.eyebrow", builderText(content, "newsletter.form.eyebrow", "Email Updates"))}
            </p>
            <h1
              id={NEWSLETTER_HEADING_ID}
              data-builder-region="newsletter.form.title"
              data-builder-kind="text"
            >
              {localizedBuilderText(locale, "newsletter.form.title", builderText(content, "newsletter.form.title", "Request District Newsletter emails"))}
            </h1>
            <p
              className="lead"
              data-builder-region="newsletter.form.body"
              data-builder-kind="text"
            >
              {localizedBuilderText(locale, "newsletter.form.body", builderText(content, "newsletter.form.body", "Get legislative information, public services, and district events by email after confirming your request."))}
            </p>
          </div>
          <div
            data-builder-region="newsletter.form"
            data-builder-kind="sections"
            data-builder-item-id="managed-form"
          >
            {residentForm}
          </div>
        </div>
      </section>
    ),
    features: (
      <section className="section newsletter-resources" data-builder-item-id="features" key="features">
        <div className="container">
          <div className="section-heading">
            <div>
              <p
                className="eyebrow"
                data-builder-region="newsletter.features.eyebrow"
                data-builder-kind="text"
              >
                {localizedBuilderText(locale, "newsletter.features.eyebrow", builderText(content, "newsletter.features.eyebrow", "Newsletter Details"))}
              </p>
              <h2 data-builder-region="newsletter.features.title" data-builder-kind="text">
                {localizedBuilderText(locale, "newsletter.features.title", builderText(content, "newsletter.features.title", "Know what happens after you request updates"))}
              </h2>
            </div>
            <p data-builder-region="newsletter.features.body" data-builder-kind="text">
              {localizedBuilderText(locale, "newsletter.features.body", builderText(content, "newsletter.features.body", "Your request remains pending until you use the confirmation link sent to your email address."))}
            </p>
          </div>
          <Cards
            cards={page.cards}
            content={content}
            regionId="newsletter.cards"
            locale={locale}
          />
        </div>
      </section>
    ),
    supporting: (
      <section className="section section-muted newsletter-supporting" data-builder-item-id="supporting" key="supporting">
        <div className="container newsletter-supporting-grid">
          <div className="timeline-item">
            <CheckCircle2 color="var(--accent)" aria-hidden="true" />
            <div>
              <strong>{localizedBuilderText(locale, "newsletter.supporting.official.title", "Official updates, delivered carefully")}</strong>
              <p>{localizedBuilderText(locale, "newsletter.supporting.official.body", "District Newsletter messages focus on legislative information, public services, and district events.")}</p>
            </div>
          </div>
          <div className="timeline-item">
            <CheckCircle2 color="var(--accent)" aria-hidden="true" />
            <div>
              <strong>{localizedBuilderText(locale, "newsletter.supporting.office.title", "You stay in control")}</strong>
              <p>{localizedBuilderText(locale, "newsletter.supporting.office.body", `Every newsletter includes an unsubscribe link. Call ${siteConfig.phoneDisplay} when you need direct District Office assistance.`)}</p>
            </div>
          </div>
        </div>
      </section>
    ),
    secondary: page.secondaryCards?.length ? (
      <section className="section" data-builder-item-id="secondary" key="secondary">
        <div className="container">
          <Cards
            cards={page.secondaryCards}
            columns="two"
            instance="secondary"
            regionId="newsletter.cards"
            content={content}
            locale={locale}
          />
        </div>
      </section>
    ) : null,
  };

  return (
    <div
      className="newsletter-page"
      data-newsletter-page-view="true"
      data-builder-region="newsletter.sections"
      data-builder-kind="sections"
    >
      {sectionIds.map((sectionId) => sections[sectionId as keyof typeof sections])}
    </div>
  );
}
