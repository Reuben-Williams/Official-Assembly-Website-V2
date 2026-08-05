import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { getImage, pages, stats } from "./data/site";
import { Cards } from "./ui/Cards";
import { ImagePanel } from "./ui/ImagePanel";

// The public route always has repository-local fallback content; the builder bridge
// may enhance it after hydration, but it never depends on a remote request.
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

export default function HomePage() {
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
              {homeFallback.eyebrow}
            </p>
            <h1
              data-builder-region="home.hero.title"
              data-builder-kind="text"
              data-i18n-key="home.hero.title"
            >
              {homeFallback.title}
            </h1>
            <p
              className="lead"
              data-builder-region="home.hero.body"
              data-builder-kind="text"
              data-i18n-key="home.hero.body"
            >
              {homeFallback.description}
            </p>
            <div className="hero-actions">
              <Link
                className="cta-link"
                data-builder-region="home.hero.primary-cta"
                data-builder-kind="link"
                href="/contact"
              >
                <span data-builder-link-label>Request Assistance</span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link
                className="secondary-link"
                data-builder-region="home.hero.secondary-cta"
                data-builder-kind="link"
                href="/resources"
              >
                <span data-builder-link-label>View Services</span>
              </Link>
            </div>
          </div>
          <ImagePanel
            asset={getImage(homeFallback.imageKey)}
            caption="District office media"
            instance="home-hero"
            priority
            variant="hero"
          />
        </div>
      </section>

      <section className="stats-band" data-builder-item-id="stats">
        <div
          className="container stats-grid"
          data-builder-region="home.stats"
          data-builder-kind="sections"
        >
          {stats.map((stat) => (
            <div className="stat-item" data-builder-item-id={stat.id} key={stat.id}>
              <span
                className="stat-value"
                data-builder-region={`home.stats.${stat.id}.value`}
                data-builder-kind="text"
              >
                {stat.value}
              </span>
              <span
                className="stat-label"
                data-builder-region={`home.stats.${stat.id}.label`}
                data-builder-kind="text"
              >
                {stat.label}
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
                Constituent Portal
              </p>
              <h2
                data-builder-region="home.portal.title"
                data-builder-kind="text"
                data-i18n-key="home.portal.title"
              >
                Core public workflows
              </h2>
            </div>
            <p data-builder-region="home.portal.body" data-builder-kind="text">
              Start with the district office, verified state resources, or the current New Jersey Legislature record.
            </p>
          </div>
          <Cards
            cards={homeFallback.cards}
            featuredFirst
            itemRegionPrefix="home.cards"
            regionId="home.portal.cards"
          />
        </div>
      </section>

      <section className="section section-muted" data-builder-item-id="workflow">
        <div className="container split">
          <ImagePanel
            asset={getImage("business")}
            caption="Community and small business engagement"
            instance="home-workflow"
          />
          <div>
            <p
              className="eyebrow"
              data-builder-region="home.workflow.eyebrow"
              data-builder-kind="text"
              data-i18n-key="home.workflow.eyebrow"
            >
              Office Workflow
            </p>
            <h2
              data-builder-region="home.workflow.title"
              data-builder-kind="text"
              data-i18n-key="home.workflow.title"
            >
              Built for clear constituent service
            </h2>
            <div
              className="timeline"
              data-builder-region="home.workflow.steps"
              data-builder-kind="sections"
            >
              {workflowSteps.map((step) => (
                <div className="timeline-item" data-builder-item-id={step.id} key={step.id}>
                  <CheckCircle2 color="var(--accent)" aria-hidden="true" />
                  <div>
                    <strong
                      data-builder-region={`home.workflow.steps.${step.id}.title`}
                      data-builder-kind="text"
                    >
                      {step.title}
                    </strong>
                    <p
                      data-builder-region={`home.workflow.steps.${step.id}.body`}
                      data-builder-kind="text"
                    >
                      {step.body}
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
