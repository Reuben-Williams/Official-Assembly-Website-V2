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
              clear public-facing district office pages.
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
            <p className="eyebrow">Office Workflow</p>
            <h2>Built for clear constituent service</h2>
            <div className="timeline">
              <div className="timeline-item">
                <CheckCircle2 color="var(--accent)" aria-hidden="true" />
                <div>
                  <strong>Public Information</strong>
                  <p>
                    Residents can quickly find office updates, resources,
                    voting information, and contact options.
                  </p>
                </div>
              </div>
              <div className="timeline-item">
                <CheckCircle2 color="var(--accent)" aria-hidden="true" />
                <div>
                  <strong>Service Requests</strong>
                  <p>
                    Contact, newsletter, and feedback flows are organized for
                    efficient staff review.
                  </p>
                </div>
              </div>
              <div className="timeline-item">
                <CheckCircle2 color="var(--accent)" aria-hidden="true" />
                <div>
                  <strong>Community Updates</strong>
                  <p>
                    News, event posts, and local photos are presented in a
                    consistent district office style.
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
