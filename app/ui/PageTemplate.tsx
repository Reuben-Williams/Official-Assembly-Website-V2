import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { getImage, type PageContent } from "../data/site";
import { Cards } from "./Cards";
import { DemoForm } from "./DemoForms";
import { ImagePanel } from "./ImagePanel";

type PageTemplateProps = {
  page: PageContent;
};

export function PageTemplate({ page }: PageTemplateProps) {
  const image = getImage(page.imageKey);
  const formType =
    page.slug === "contact" || page.slug === "newsletter" || page.slug === "survey"
      ? page.slug
      : null;

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">{page.eyebrow}</p>
            <h1>{page.title}</h1>
            <p className="lead">{page.description}</p>
            <div className="hero-actions">
              <Link className="cta-link" href="/contact">
                Contact the Office <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link className="secondary-link" href="/newsletter">
                Get Updates
              </Link>
            </div>
          </div>
          <ImagePanel
            asset={image}
            caption="Local project image asset"
            priority
            variant="hero"
          />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Page Features</p>
              <h2>Ready for a live office workflow</h2>
            </div>
            <p>
              The old Stitch page concept has been converted into reusable Next
              sections, with content and images centralized for later CMS or
              Supabase replacement.
            </p>
          </div>
          <Cards cards={page.cards} featuredFirst={page.slug === "contact"} />
        </div>
      </section>

      {formType ? (
        <section className="section section-muted">
          <div className="container split">
            <div>
              <p className="eyebrow">Static Demo Form</p>
              <h2>Prepared for Supabase intake</h2>
              <p className="lead">
                This form validates and confirms locally for GitHub Pages. Once
                Supabase is approved, the submit handler can insert rows using
                the prepared browser client.
              </p>
            </div>
            <DemoForm type={formType} />
          </div>
        </section>
      ) : null}

      <section className="section section-muted">
        <div className="container split">
          <ImagePanel
            asset={getImage(page.slug === "community" ? "graduation" : "coverage")}
            caption="Additional local media"
          />
          <div className="timeline">
            <div className="timeline-item">
              <CheckCircle2 color="var(--accent)" aria-hidden="true" />
              <div>
                <strong>No generated image URLs</strong>
                <p>
                  Images are stored under <code>public/images</code> for static
                  export and GitHub Pages reliability.
                </p>
              </div>
            </div>
            <div className="timeline-item">
              <CheckCircle2 color="var(--accent)" aria-hidden="true" />
              <div>
                <strong>Vercel-ready structure</strong>
                <p>
                  App Router routes can stay static now and grow into server
                  routes or server actions later.
                </p>
              </div>
            </div>
            <div className="timeline-item">
              <CheckCircle2 color="var(--accent)" aria-hidden="true" />
              <div>
                <strong>Supabase-ready forms</strong>
                <p>
                  Environment variables and client setup are in place without
                  blocking the current static demo.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {page.secondaryCards?.length ? (
        <section className="section">
          <div className="container">
            <Cards cards={page.secondaryCards} columns="two" />
          </div>
        </section>
      ) : null}
    </>
  );
}
