import "server-only";
import { pages } from "../app/data/site";
import { officialLegislatureProfile as profile } from "../app/data/official-legislature-profile";
import { builderText, builderSectionIds, loadBuilderServerContent } from "./builder/server-content";
import { listPublishedPosts, publicPostHref } from "./builder/published-posts";
import { getBuilderAdminClient } from "./supabase/admin";
import { loadOfficialAssemblyPublicCalendar } from "./calendar/server";
import { localizedCalendarField } from "./calendar/localization";
import { localizedBuilderText } from "../app/i18n/catalog.server";
import type { PublicLocale } from "../app/i18n/locale";
import type { PublicSearchEntry } from "./public-search";
import { publishedDocumentText } from "./public-search";
import { editorPlainText } from "./builder/editor-text";
import { districtConnections } from "../app/data/district-connections";

// Only public, published content is read. Never search drafts, media metadata,
// staff accounts, form submissions, or newsletter subscribers.
export async function loadPublicSearchEntries(locale: PublicLocale) {
  const results = await Promise.allSettled(pages.map(async page => {
    const content = await loadBuilderServerContent(page.href);
    const slug = page.slug ?? "home";
    const text = (key: string, fallback: string) => {
      const value = content.regions[key];
      return editorPlainText(localizedBuilderText(locale, key, value?.type === "richText" ? value.value : builderText(content, key, fallback)));
    };
    const title = text(`${slug}.hero.title`, page.title);
    const entries: PublicSearchEntry[] = [{ title, page: title, section: locale === "es" ? "Página" : "Page", href: page.href, text: text(`${slug}.hero.body`, page.description) }];
    const sections = builderSectionIds(content, `${slug}.sections`, ["hero", "features", "secondary", "official-profile", "workflow"]);
    const shownCards = new Set(builderSectionIds(content, `${slug}.cards`, [...page.cards, ...(page.secondaryCards ?? [])].map(card => card.id)));
    for (const [section, cards] of [["features", page.cards], ["secondary", page.secondaryCards ?? []]] as const) {
      if (!sections.includes(section)) continue;
      for (const card of cards) {
        if (slug !== "voting" && !shownCards.has(card.id)) continue;
        entries.push({ title: text(`${slug}.cards.${card.id}.title`, card.title), page: title,
          section: text(`${slug}.features.title`, locale === "es" ? "Recursos de la página" : "Page resources"),
          href: `${page.href}#${section}`, text: text(`${slug}.cards.${card.id}.body`, card.text) });
      }
    }
    if (slug === "home") {
      // This approved copy is rendered without a saved region override. Search
      // the same source used by the public volunteer card, not just overrides.
      const volunteerTitle = localizedBuilderText(locale, "home.connections.volunteer.title", districtConnections.volunteer.title);
      entries.push({ title: volunteerTitle, page: title, section: volunteerTitle, href: "/#volunteer",
        text: locale === "es" ? districtConnections.volunteer.spanish : districtConnections.volunteer.english });
      const defaults: Record<string, string> = {
        office: `${profile.office.address}\nPhone ${profile.office.phoneDisplay}\nFax ${profile.office.fax}`,
        biography: [profile.occupation, ...profile.publicService, ...profile.legislativeService].join("\n"),
        education: profile.education.join("\n"),
        committees: profile.committees.map(c => `${c.name}${c.position ? `, ${c.position}` : ""}`).join("\n"),
      };
      for (const [card, fallback] of Object.entries(defaults)) entries.push({ title: text(`home.official.${card}.heading`, card === "office" ? "District office" : card[0].toUpperCase() + card.slice(1)), page: title,
        section: text("home.official.title", "Your District 34 representative"), href: "/#representative", text: text(`home.official.${card}.details`, fallback) });
    }
    // Include staff-published copy beyond the built-in cards. Skip metadata,
    // image descriptions and private/editor state; link to its public section.
    const sectionNames: Record<string, string> = { hero: "Overview", official: "Your District 34 representative", workflow: "Constituent guidance", connections: "Community connections", features: "Page resources", form: "Resident form", newsletter: "Newsletter", "current-resource": "Current resource", volunteer: "Volunteer" };
    const anchors: Record<string, string> = { hero: "overview", official: "representative", workflow: "guidance", features: "features", form: "form", secondary: "secondary" };
    for (const [key, value] of Object.entries(content.regions)) {
      if (!key.startsWith(`${slug}.`) || (value.type !== "text" && value.type !== "richText") || !value.value.trim()) continue;
      const group = key.split(".")[1];
      if (!sectionNames[group] || (group === "features" && !sections.includes("features"))) continue;
      const section = text(`${slug}.${group}.title`, sectionNames[group]);
      const copy = text(key, value.value);
      if (entries.some(entry => entry.text.includes(copy))) continue;
      const anchor = anchors[group];
      entries.push({ title: section, page: title, section, href: `${page.href}${anchor && (slug !== "home" || ["official", "workflow"].includes(group)) ? `#${anchor}` : ""}`, text: copy });
    }
    return entries;
  }));
  const entries = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
  let partial = results.some(result => result.status === "rejected");
  entries.push({ title: locale === "es" ? "Comunicados de prensa" : "Press Releases", page: "News", section: "Press Releases", href: "/news/press-releases", text: locale === "es" ? "Comunicados publicados por la oficina del distrito." : "Published district office press releases." },
    { title: locale === "es" ? "Privacidad" : "Privacy", page: "Privacy", section: "Page", href: "/privacy", text: "Privacy notice, newsletter consent and resident information. Privacidad y consentimiento." });
  const client = getBuilderAdminClient();
  if (client) {
    try {
      const posts = await listPublishedPosts(client);
      for (const post of posts) entries.push({ title: post.title, page: locale === "es" ? "Noticias" : "News", section: locale === "es" ? "Artículo" : "Article", href: publicPostHref(post.slug), text: `${post.excerpt ?? ""} ${publishedDocumentText(post.snapshot?.data.body)}` });
    } catch { partial = true; }
  }
  const calendar = await loadOfficialAssemblyPublicCalendar();
  if (calendar.status === "ready") for (const event of calendar.events) entries.push({ title: localizedCalendarField(event, locale, "title").text,
    page: locale === "es" ? "Eventos" : "Events", section: locale === "es" ? "Calendario comunitario" : "Community calendar", href: `/events#event-${event.id}`,
    text: `${localizedCalendarField(event, locale, "description").text} ${event.locationName} ${event.locationAddress}` });
  else partial = true;
  return { entries, partial };
}
