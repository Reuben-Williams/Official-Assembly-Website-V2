import type { Metadata } from "next";

import { builderText, loadBuilderServerContent } from "../../lib/builder/server-content";
import { loadOfficialAssemblyPublicCalendar } from "../../lib/calendar/server";
import { approvedBrandAssets } from "../../lib/brand/approved-assets";
import { withBrandSocialMetadata } from "../../lib/brand/metadata";
import { localizedBuilderText } from "../i18n/catalog.server";
import { readPublicLocale } from "../i18n/server";
import { PublicEventsSection } from "../ui/PublicEventsSection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const [content, locale] = await Promise.all([
    loadBuilderServerContent("/events"),
    readPublicLocale(),
  ]);
  const title = localizedBuilderText(locale, "metadata.events.title", builderText(content, "metadata.events.title", "Community Events"));
  const description = localizedBuilderText(locale, "metadata.events.description", builderText(
    content,
    "metadata.events.description",
    "Upcoming public events hosted by the District 34 office.",
  ));
  const canonicalUrl = new URL("/events", process.env.NEXT_PUBLIC_SITE_URL || "https://www.assemblywomanmorales.com").toString();
  return withBrandSocialMetadata({ title, description, alternates: { canonical: canonicalUrl } }, {
    title,
    description,
    locale,
    canonicalUrl,
  }, approvedBrandAssets);
}

export default async function EventsPage() {
  const [content, locale, calendar] = await Promise.all([
    loadBuilderServerContent("/events"),
    readPublicLocale(),
    loadOfficialAssemblyPublicCalendar({ limit: 100 }),
  ]);

  return (
    <div data-builder-region="events.sections" data-builder-kind="sections">
      <section className="hero" data-builder-item-id="hero">
        <div className="container">
          <p className="eyebrow" data-builder-region="events.hero.eyebrow" data-builder-kind="text">
            {localizedBuilderText(locale, "events.hero.eyebrow", builderText(content, "events.hero.eyebrow", "District 34 Calendar"))}
          </p>
          <h1 data-builder-region="events.hero.title" data-builder-kind="text">
            {localizedBuilderText(locale, "events.hero.title", builderText(content, "events.hero.title", "Community Events"))}
          </h1>
          <p className="lead" data-builder-region="events.hero.body" data-builder-kind="text">
            {localizedBuilderText(locale, "events.hero.body", builderText(content, "events.hero.body", "Find upcoming public events hosted by the District 34 office. Event details are published only after office review."))}
          </p>
        </div>
      </section>
      <PublicEventsSection calendar={calendar} content={content} locale={locale} variant="agenda" />
    </div>
  );
}
