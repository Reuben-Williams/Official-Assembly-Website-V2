import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { getImage, pages, stats } from "./data/site";
import { Cards } from "./ui/Cards";
import { ImagePanel } from "./ui/ImagePanel";

const home = pages[0];

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">{home.eyebrow}</p>
            <h1>{home.title}</h1>
            <p className="lead">{home.description}</p>
            <div className="hero-actions">
              <Link className="cta-link" href="/contact">
                Request Assistance <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link className="secondary-link" href="/resources">
                View Services
              </Link>
            </div>
          </div>
          <ImagePanel
            asset={getImage(home.imageKey)}
            caption="Real district office media"
            priority
            variant="hero"
          />
        </div>
      </section>

      <section className="stats-band">
        <div className="container stats-grid">
          {stats.map((stat) => (
            <div className="stat-item" key={stat.value}>
              <span className="stat-value">{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Constituent Portal</p>
              <h2>Core public workflows</h2>
            </div>
            <p>
              The Stitch concepts have been consolidated into a maintainable
              Next.js site with reusable components, real local images, and
              deployment settings for a client-facing demo.
            </p>
          </div>
          <Cards cards={home.cards} featuredFirst />
        </div>
      </section>

      <section className="section section-muted">
        <div className="container split">
          <ImagePanel
            asset={getImage("business")}
            caption="Community and small business engagement"
          />
          <div>
            <p className="eyebrow">Deployment Path</p>
            <h2>Static demo now, full stack later</h2>
            <div className="timeline">
              <div className="timeline-item">
                <CheckCircle2 color="var(--accent)" aria-hidden="true" />
                <div>
                  <strong>GitHub Pages</strong>
                  <p>
                    Static export, repository base path, and Pages workflow are
                    configured for the public demo URL.
                  </p>
                </div>
              </div>
              <div className="timeline-item">
                <CheckCircle2 color="var(--accent)" aria-hidden="true" />
                <div>
                  <strong>Vercel</strong>
                  <p>
                    App Router structure can move to Vercel when the final
                    domain is confirmed.
                  </p>
                </div>
              </div>
              <div className="timeline-item">
                <CheckCircle2 color="var(--accent)" aria-hidden="true" />
                <div>
                  <strong>Supabase</strong>
                  <p>
                    Environment variables and the browser client are prepared
                    for forms, newsletter subscriptions, and survey responses.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
