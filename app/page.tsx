import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { getImage, pages, stats } from "./data/site";
import { Cards } from "./ui/Cards";
import { ImagePanel } from "./ui/ImagePanel";
import {
  builderLink,
  builderSectionIds,
  builderText,
  loadBuilderServerContent,
  type BuilderServerContent,
} from "../lib/builder/server-content";

// Checked-in values are used only when an authoritative server read confirms that
// a registered region has no kind-correct published override.
const homeFallback = pages[0];
const workflowSteps = [
  {
    id: "public-information",
    title: "Public Information",
    body: "Find official office, legislative, voting, and contact information."
  },
  {
    id: "service-requests",
    title: "Service Requests",
    body: "Contact the district office for help identifying the right New Jersey agency."
  },
  {
    id: "community-updates",
    title: "Community Updates",
    body: "Follow verified district notices and official legislative records."
  }
];

type HomePageViewProps = {
  content: BuilderServerContent;
};

function HomePageView({ content }: HomePageViewProps) {
  const primaryCta = builderLink(content, "home.hero.primary-cta", {
    href: "/contact",
    label: "Request Assistance",
  });
  const secondaryCta = builderLink(content, "home.hero.secondary-cta", {
    href: "/resources",
    label: "View Services",
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

  return (
    <div data-builder-region="home.sections" data-builder-kind="sections">
      <section className="hero" data-builder-item-id="hero">
        <div className="container hero-grid">
          <div>
            <p
              className="eyebrow"
              data-builder-region="home.hero.eyebrow"
              data-builder-kind="text"
              data-i18n-key="home.hero.eyebrow"
            >
              {builderText(content, "home.hero.eyebrow", homeFallback.eyebrow)}
            </p>
            <h1
              data-builder-region="home.hero.title"
              data-builder-kind="text"
              data-i18n-key="home.hero.title"
            >
              {builderText(content, "home.hero.title", homeFallback.title)}
            </h1>
            <p
              className="lead"
              data-builder-region="home.hero.body"
              data-builder-kind="text"
              data-i18n-key="home.hero.body"
            >
              {builderText(content, "home.hero.body", homeFallback.description)}
            </p>
            <div className="hero-actions">
              <Link
                className="cta-link"
                data-builder-region="home.hero.primary-cta"
                data-builder-kind="link"
                href={primaryCta.href}
              >
                <span data-builder-link-label>{primaryCta.label}</span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link
                className="secondary-link"
                data-builder-region="home.hero.secondary-cta"
                data-builder-kind="link"
                href={secondaryCta.href}
              >
                <span data-builder-link-label>{secondaryCta.label}</span>
              </Link>
            </div>
          </div>
          <ImagePanel
            asset={getImage(homeFallback.imageKey)}
            caption="District office media"
            instance="home-hero"
            priority
            variant="hero"
            content={content}
          />
        </div>
      </section>

      <section className="stats-band" data-builder-item-id="stats">
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
                {builderText(content, `home.stats.${stat.id}.value`, stat.value)}
              </span>
              <span
                className="stat-label"
                data-builder-region={`home.stats.${stat.id}.label`}
                data-builder-kind="text"
              >
                {builderText(content, `home.stats.${stat.id}.label`, stat.label)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="section" data-builder-item-id="portal">
        <div className="container">
          <div className="section-heading">
            <div>
              <p
                className="eyebrow"
                data-builder-region="home.portal.eyebrow"
                data-builder-kind="text"
                data-i18n-key="home.portal.eyebrow"
              >
                {builderText(content, "home.portal.eyebrow", "Constituent Portal")}
              </p>
              <h2
                data-builder-region="home.portal.title"
                data-builder-kind="text"
                data-i18n-key="home.portal.title"
              >
                {builderText(content, "home.portal.title", "Core public workflows")}
              </h2>
            </div>
            <p data-builder-region="home.portal.body" data-builder-kind="text">
              {builderText(
                content,
                "home.portal.body",
                "Start with the district office, verified state resources, or the current New Jersey Legislature record.",
              )}
            </p>
          </div>
          <Cards
            cards={homeFallback.cards}
            featuredFirst
            itemRegionPrefix="home.cards"
            regionId="home.portal.cards"
            content={content}
          />
        </div>
      </section>

      <section className="section section-muted" data-builder-item-id="workflow">
        <div className="container split">
          <ImagePanel
            asset={getImage("business")}
            caption="Community and small business engagement"
            instance="home-workflow"
            content={content}
          />
          <div>
            <p
              className="eyebrow"
              data-builder-region="home.workflow.eyebrow"
              data-builder-kind="text"
              data-i18n-key="home.workflow.eyebrow"
            >
              {builderText(content, "home.workflow.eyebrow", "Office Workflow")}
            </p>
            <h2
              data-builder-region="home.workflow.title"
              data-builder-kind="text"
              data-i18n-key="home.workflow.title"
            >
              {builderText(content, "home.workflow.title", "Built for clear constituent service")}
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
                      {builderText(content, `home.workflow.steps.${step.id}.title`, step.title)}
                    </strong>
                    <p
                      data-builder-region={`home.workflow.steps.${step.id}.body`}
                      data-builder-kind="text"
                    >
                      {builderText(content, `home.workflow.steps.${step.id}.body`, step.body)}
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

export default async function HomePage() {
  const content = await loadBuilderServerContent("/");
  return <HomePageView content={content} />;
}
