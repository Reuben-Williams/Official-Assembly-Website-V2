import Link from "next/link";

import { builderText, type BuilderServerContent } from "../../lib/builder/server-content";
import { ResidentForm } from "./ResidentForms";

type NewsletterSignupSectionProps = {
  content: BuilderServerContent;
  regions: {
    eyebrow: string;
    title: string;
    body: string;
    form: string;
  };
  fallback: {
    eyebrow: string;
    title: string;
    body: string;
  };
  showDedicatedPageLink: boolean;
  embedded?: boolean;
};

export async function NewsletterSignupSection({
  content,
  regions,
  fallback,
  showDedicatedPageLink,
  embedded = false,
}: NewsletterSignupSectionProps) {
  const residentForm = await ResidentForm({ type: "newsletter" });

  const contents = (
    <>
      <div>
          <p
            className="eyebrow"
            data-builder-region={regions.eyebrow}
            data-builder-kind="text"
          >
            {builderText(content, regions.eyebrow, fallback.eyebrow)}
          </p>
          <h2 data-builder-region={regions.title} data-builder-kind="text">
            {builderText(content, regions.title, fallback.title)}
          </h2>
          <p
            className="lead"
            data-builder-region={regions.body}
            data-builder-kind="text"
          >
            {builderText(content, regions.body, fallback.body)}
          </p>
          {showDedicatedPageLink ? (
            <Link className="secondary-link" href="/newsletter">
              Review newsletter signup details
            </Link>
          ) : null}
      </div>
      <div
        data-builder-region={regions.form}
        data-builder-kind="sections"
        data-builder-item-id="managed-form"
      >
        {residentForm}
      </div>
    </>
  );

  if (embedded) {
    return <div className="newsletter-signup-embedded">{contents}</div>;
  }

  return (
    <section className="section section-muted" data-builder-item-id="form">
      <div className="container split">
        {contents}
      </div>
    </section>
  );
}
