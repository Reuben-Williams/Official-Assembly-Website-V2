import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { getImage, siteConfig, type PageContent } from "../data/site";
import { Cards } from "./Cards";
import { ResidentForm } from "./ResidentForms";
import { ImagePanel } from "./ImagePanel";

type PageTemplateProps = {
  page: PageContent;
};

export async function PageTemplate({ page }: PageTemplateProps) {
  const slug = page.slug ?? "home";
  const formType =
    slug === "contact" || slug === "newsletter" || slug === "survey" ? slug : null;
  const supportingImage = slug === "community" ? "graduation" : "coverage";
  const residentForm = formType ? await ResidentForm({ type: formType }) : null;

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
              {page.eyebrow}
            </p>
            <h1
              data-builder-region={`${slug}.hero.title`}
              data-builder-kind="text"
              data-i18n-key={`${slug}.hero.title`}
            >
              {page.title}
            </h1>
            <p
              className="lead"
              data-builder-region={`${slug}.hero.body`}
              data-builder-kind="text"
              data-i18n-key={`${slug}.hero.body`}
            >
              {page.description}
            </p>
            <div className="hero-actions">
              <Link
                className="cta-link"
                data-builder-region={`${slug}.hero.primary-cta`}
                data-builder-kind="link"
                href="/contact"
              >
                <span data-builder-link-label>Contact the Office</span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link
                className="secondary-link"
                data-builder-region={`${slug}.hero.secondary-cta`}
                data-builder-kind="link"
                href="/newsletter"
              >
                <span data-builder-link-label>Get Updates</span>
              </Link>
            </div>
          </div>
          <ImagePanel
            asset={getImage(page.imageKey)}
            caption="District office media"
            instance={`${slug}-hero`}
            priority
            variant="hero"
          />
        </div>
      </section>

      <section className="section" data-builder-item-id="features">
        <div className="container">
          <div className="section-heading">
            <div>
              <p
                className="eyebrow"
                data-builder-region={`${slug}.features.eyebrow`}
                data-builder-kind="text"
              >
                Page Resources
              </p>
              <h2
                data-builder-region={`${slug}.features.title`}
                data-builder-kind="text"
              >
                Verified paths for District 34 residents
              </h2>
            </div>
            <p
              data-builder-region={`${slug}.features.body`}
              data-builder-kind="text"
            >
              Use these links for current public information or contact the district office at {siteConfig.phoneDisplay}.
            </p>
          </div>
          <Cards cards={page.cards} featuredFirst={slug === "contact"} regionId={`${slug}.cards`} />
        </div>
      </section>

      {formType ? (
        <section className="section section-muted" data-builder-item-id="form">
          <div className="container split">
            <div>
              <p
                className="eyebrow"
                data-builder-region="global.template.form-eyebrow"
                data-builder-kind="text"
              >
                {formType === "newsletter" ? "Email Updates" : "Resident Form"}
              </p>
              <h2
                data-builder-region="global.template.form-title"
                data-builder-kind="text"
              >
                {formType === "newsletter" ? "Request District Newsletter emails" : "District office intake"}
              </h2>
              <p
                className="lead"
                data-builder-region="global.template.form-body"
                data-builder-kind="text"
              >
                {formType === "newsletter"
                  ? "The live form is shown only when privacy, consent, confirmation, and delivery readiness checks are complete."
                  : "Online submission is shown only when an approved form revision and verification service are available."}
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
          />
          <div className="timeline">
            <div className="timeline-item">
              <CheckCircle2 color="var(--accent)" aria-hidden="true" />
              <div>
                <strong>Official sources first</strong>
                <p>State services, voting details, and legislative records link to current government sources.</p>
              </div>
            </div>
            <div className="timeline-item">
              <CheckCircle2 color="var(--accent)" aria-hidden="true" />
              <div>
                <strong>District office access</strong>
                <p>Residents can call {siteConfig.phoneDisplay} when online intake is unavailable.</p>
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
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
