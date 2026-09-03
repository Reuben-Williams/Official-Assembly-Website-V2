import type { PublishedPost } from "@reuben-williams/content";
import { ArrowRight, ArrowUpRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

import { getImage, pages, stats } from "../data/site";
import { districtConnections } from "../data/district-connections";
import {
  builderLink,
  builderSectionIds,
  builderText,
  type BuilderServerContent,
} from "../../lib/builder/server-content";
import { DistrictConnectionsSection } from "./DistrictConnectionsSection";
import { ImagePanel } from "./ImagePanel";
import { LatestUpdatesSection } from "./LatestUpdatesSection";
import { OfficialProfileSection } from "./OfficialProfileSection";
import { localizedBuilderText } from "../i18n/catalog.server";
import type { PublicLocale } from "../i18n/locale";
import type { PublicCalendarLoad } from "../../lib/calendar/repository";
import { approvedBrandAssets } from "../../lib/brand/approved-assets";
import type { VerifiedApprovedBrandAssets } from "../../lib/brand/assets";
import { HomepageBrandBanner } from "./HomepageBrandBanner";
import { PublicEventsSection } from "./PublicEventsSection";

// Checked-in values are used only when an authoritative server read confirms that
// a registered region has no kind-correct published override.
const homeFallback = pages[0];
const workflowSteps = [
  {
    id: "public-information",
    title: "Use current public records",
    body: "Official state links lead to the current legislative profile, sponsored bills, votes, and contact form."
  },
  {
    id: "service-requests",
    title: "Contact the District Office",
    body: "Call or send a message when you need help identifying the right New Jersey state agency."
  },
  {
    id: "community-updates",
    title: "Choose the right update path",
    body: "District posts appear on this website, while newsletter signup uses a confirmed email subscription."
  }
];

type HomePageViewProps = {
  assets?: VerifiedApprovedBrandAssets | null;
  calendar: PublicCalendarLoad;
  content: BuilderServerContent;
  posts: readonly PublishedPost[];
  locale?: PublicLocale;
};

export async function HomePageView({
  assets = approvedBrandAssets,
  calendar,
  content,
  posts,
  locale = "en",
}: HomePageViewProps) {
  const contactCta = builderLink(content, "home.hero.primary-cta", {
    href: "/contact",
    label: "Contact the Office",
  });
  const newsCta = builderLink(content, "home.hero.news-cta", {
    href: "/news",
    label: "News & Updates",
  });
  const newsletterCta = builderLink(content, "home.hero.newsletter-cta", {
    href: "/newsletter",
    label: "Get the Newsletter",
  });
  const volunteerCta = builderLink(content, "home.hero.volunteer-cta", {
    href: districtConnections.volunteer.href,
    label: "Volunteer",
  });
  const statsById = new Map(stats.map((stat) => [stat.id, stat]));
  const orderedStats = builderSectionIds(content, "home.stats", stats.map((stat) => stat.id))
    .flatMap((id) => statsById.get(id) ?? []);
  const stepsById = new Map(workflowSteps.map((step) => [step.id, step]));
  const orderedSteps = builderSectionIds(
    content,
    "home.workflow.steps",
    workflowSteps.map((step) => step.id),
  ).flatMap((id) => stepsById.get(id) ?? []);
  const connections = await DistrictConnectionsSection({ content, locale });

  return (
    <div data-builder-region="home.sections" data-builder-kind="sections">
      <section className="hero home-hero" data-builder-item-id="hero" data-home-section="hero">
        <div className="container home-hero-shell">
          <div className="home-hero-copy">
            <p
              className="eyebrow"
              data-builder-region="home.hero.eyebrow"
              data-builder-kind="text"
              data-i18n-key="home.hero.eyebrow"
            >
              {localizedBuilderText(locale, "home.hero.eyebrow", builderText(content, "home.hero.eyebrow", homeFallback.eyebrow))}
            </p>
            <h1
              data-builder-region="home.hero.title"
              data-builder-kind="text"
              data-i18n-key="home.hero.title"
            >
              {localizedBuilderText(locale, "home.hero.title", builderText(content, "home.hero.title", homeFallback.title))}
            </h1>
            <p
              className="lead"
              data-builder-region="home.hero.body"
              data-builder-kind="text"
              data-i18n-key="home.hero.body"
            >
              {localizedBuilderText(locale, "home.hero.body", builderText(content, "home.hero.body", homeFallback.description))}
            </p>
          </div>
          <HomepageBrandBanner assets={assets} content={content} locale={locale} />
          <div
            className="hero-actions home-hero-actions"
            aria-label={localizedBuilderText(locale, "home.hero.actions", "Primary District 34 actions")}
            data-home-hero-actions="true"
          >
            <Link
              className="cta-link"
              data-builder-region="home.hero.primary-cta"
              data-builder-kind="link"
              href={contactCta.href}
            >
              <span data-builder-link-label>{localizedBuilderText(locale, "home.hero.primary-cta.label", contactCta.label)}</span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link
              className="secondary-link"
              data-builder-region="home.hero.news-cta"
              data-builder-kind="link"
              href={newsCta.href}
            >
              <span data-builder-link-label>{localizedBuilderText(locale, "home.hero.news-cta.label", newsCta.label)}</span>
            </Link>
            <Link
              className="secondary-link"
              data-builder-region="home.hero.newsletter-cta"
              data-builder-kind="link"
              href={newsletterCta.href}
            >
              <span data-builder-link-label>{localizedBuilderText(locale, "home.hero.newsletter-cta.label", newsletterCta.label)}</span>
            </Link>
            <a
              className="secondary-link home-hero-volunteer"
              data-builder-region="home.hero.volunteer-cta"
              data-builder-kind="link"
              href={districtConnections.volunteer.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span data-builder-link-label>{localizedBuilderText(locale, "home.hero.volunteer-cta.label", volunteerCta.label)}</span>
              <ArrowUpRight size={18} aria-hidden="true" />
              <span className="home-hero-sr-only">
                {localizedBuilderText(locale, "global.external.new-tab", "opens in a new tab")}
              </span>
            </a>
          </div>
        </div>
      </section>

      <OfficialProfileSection content={content} locale={locale} />
      <section className="stats-band" data-builder-item-id="stats" data-home-section="access">
        <div
          className="container stats-grid"
          data-builder-region="home.stats"
          data-builder-kind="sections"
        >
          {orderedStats.map((stat) => (
            <div className="stat-item" data-builder-item-id={stat.id} key={stat.id}>
              <span
                className="stat-value"
                data-builder-region={`home.stats.${stat.id}.value`}
                data-builder-kind="text"
              >
                {localizedBuilderText(locale, `home.stats.${stat.id}.value`, builderText(content, `home.stats.${stat.id}.value`, stat.value))}
              </span>
              <span
                className="stat-label"
                data-builder-region={`home.stats.${stat.id}.label`}
                data-builder-kind="text"
              >
                {localizedBuilderText(locale, `home.stats.${stat.id}.label`, builderText(content, `home.stats.${stat.id}.label`, stat.label))}
              </span>
            </div>
          ))}
        </div>
      </section>
      {connections}
      <LatestUpdatesSection content={content} locale={locale} posts={posts} />
      <PublicEventsSection calendar={calendar} content={content} locale={locale} variant="home" />

      <section className="section section-muted" data-builder-item-id="workflow" data-home-section="guidance">
        <div className="container split">
          <ImagePanel
            asset={getImage("professional-home-supporting")}
            caption="Community and small business engagement"
            instance="home-workflow"
            content={content}
            locale={locale}
          />
          <div>
            <p
              className="eyebrow"
              data-builder-region="home.workflow.eyebrow"
              data-builder-kind="text"
              data-i18n-key="home.workflow.eyebrow"
            >
              {localizedBuilderText(locale, "home.workflow.eyebrow", builderText(content, "home.workflow.eyebrow", "Constituent guidance"))}
            </p>
            <h2
              data-builder-region="home.workflow.title"
              data-builder-kind="text"
              data-i18n-key="home.workflow.title"
            >
              {localizedBuilderText(locale, "home.workflow.title", builderText(content, "home.workflow.title", "Start with the path that matches your need"))}
            </h2>
            <div
              className="timeline"
              data-builder-region="home.workflow.steps"
              data-builder-kind="sections"
            >
              {orderedSteps.map((step) => (
                <div className="timeline-item" data-builder-item-id={step.id} key={step.id}>
                  <CheckCircle2 color="var(--accent)" aria-hidden="true" />
                  <div>
                    <strong
                      data-builder-region={`home.workflow.steps.${step.id}.title`}
                      data-builder-kind="text"
                    >
                      {localizedBuilderText(locale, `home.workflow.steps.${step.id}.title`, builderText(content, `home.workflow.steps.${step.id}.title`, step.title))}
                    </strong>
                    <p
                      data-builder-region={`home.workflow.steps.${step.id}.body`}
                      data-builder-kind="text"
                    >
                      {localizedBuilderText(locale, `home.workflow.steps.${step.id}.body`, builderText(content, `home.workflow.steps.${step.id}.body`, step.body))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
