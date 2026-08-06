import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { getImage } from "./data/site";
import { ImagePanel } from "./ui/ImagePanel";

export const metadata: Metadata = {
  title: "Page not found"
};

export default function NotFoundPage() {
  const image = { ...getImage("hero"), regionId: "404.hero.image" };

  return (
    <section className="hero" data-builder-content-path="/404">
      <div className="container hero-grid">
        <div>
          <p
            className="eyebrow"
            data-builder-kind="text"
            data-builder-region="404.hero.eyebrow"
          >
            Page not found
          </p>
          <h1 data-builder-kind="text" data-builder-region="404.hero.title">
            We couldn&apos;t find that page.
          </h1>
          <p
            className="lead"
            data-builder-kind="text"
            data-builder-region="404.hero.body"
          >
            The page may have moved, or the address may be incorrect. Use one of the links below to continue.
          </p>
          <div className="hero-actions">
            <Link
              className="cta-link"
              data-builder-kind="link"
              data-builder-region="404.hero.primary-cta"
              href="/"
            >
              <span data-builder-link-label>Return home</span>
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link
              className="secondary-link"
              data-builder-kind="link"
              data-builder-region="404.hero.secondary-cta"
              href="/resources"
            >
              <span data-builder-link-label>View resources</span>
            </Link>
          </div>
        </div>
        <ImagePanel
          asset={image}
          caption="District office media"
          instance="404-hero"
          priority
          variant="hero"
        />
      </div>
    </section>
  );
}
