import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";

import type { PublicCalendarEvent } from "../../lib/calendar/contract";
import type { PublicCalendarLoad } from "../../lib/calendar/repository";
import { builderText, type BuilderServerContent } from "../../lib/builder/server-content";
import { localizedBuilderText } from "../i18n/catalog.server";
import type { PublicLocale } from "../i18n/locale";
import styles from "./public-events-section.module.css";

type PublicEventsSectionProps = Readonly<{
  calendar: PublicCalendarLoad;
  content: BuilderServerContent;
  locale: PublicLocale;
  variant: "home" | "agenda";
}>;

function eventText(event: PublicCalendarEvent, locale: PublicLocale, field: "title" | "description" | "actionLabel") {
  if (field === "title") return locale === "es" ? event.titleEs : event.titleEn;
  if (field === "description") return locale === "es" ? event.descriptionEs : event.descriptionEn;
  return locale === "es" ? event.actionLabelEs : event.actionLabelEn;
}

function localDateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function formatEventSchedule(event: PublicCalendarEvent, locale: PublicLocale) {
  const localeTag = locale === "es" ? "es-US" : "en-US";
  const start = new Date(event.startAt);
  const date = new Intl.DateTimeFormat(localeTag, {
    timeZone: event.displayTimeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(start);
  const timeFormatter = new Intl.DateTimeFormat(localeTag, {
    timeZone: event.displayTimeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  if (!event.endAt) return `${date} · ${timeFormatter.format(start)}`;

  const end = new Date(event.endAt);
  if (localDateKey(start) === localDateKey(end)) {
    return `${date} · ${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
  }
  const endDate = new Intl.DateTimeFormat(localeTag, {
    timeZone: event.displayTimeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(end);
  return `${date} · ${timeFormatter.format(start)} – ${endDate} · ${timeFormatter.format(end)}`;
}

function EventAgenda({ events, locale }: { events: readonly PublicCalendarEvent[]; locale: PublicLocale }) {
  return (
    <ol className={styles.agenda} aria-label={locale === "es" ? "Próximos eventos" : "Upcoming events"}>
      {events.map((event) => {
        const title = eventText(event, locale, "title");
        return (
          <li key={event.id}>
            <article className={styles.eventCard} data-public-event-id={event.id}>
              {event.mediaUrl ? (
                // Managed-media URLs are short-lived and server-resolved; preserving the original host avoids stale copies.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={styles.eventImage}
                  src={event.mediaUrl}
                  alt={`${title} — ${locale === "es" ? "imagen del evento" : "event image"}`}
                />
              ) : null}
              <div className={styles.eventBody}>
                <p className={styles.schedule}>
                  <CalendarDays size={18} aria-hidden="true" />
                  <time dateTime={event.startAt}>{formatEventSchedule(event, locale)}</time>
                </p>
                <h3>{title}</h3>
                <p>{eventText(event, locale, "description")}</p>
                <p className={styles.location}>
                  <MapPin size={18} aria-hidden="true" />
                  <span>{event.locationName}<br />{event.locationAddress}</span>
                </p>
                {event.actionUrl ? (
                  <a className={styles.eventAction} href={event.actionUrl} target="_blank" rel="noopener noreferrer">
                    {eventText(event, locale, "actionLabel")}
                    <ArrowRight size={17} aria-hidden="true" />
                    <span className={styles.srOnly}>{locale === "es" ? " (se abre en una pestaña nueva)" : " (opens in a new tab)"}</span>
                  </a>
                ) : null}
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

export function PublicEventsSection({ calendar, content, locale, variant }: PublicEventsSectionProps) {
  const prefix = variant === "home" ? "home.events" : "events";
  const events = calendar.status === "ready"
    ? calendar.events.slice(0, variant === "home" ? 3 : calendar.events.length)
    : [];
  const empty = calendar.status === "ready" && events.length === 0;
  const titleRegion = variant === "home" ? `${prefix}.title` : `${prefix}.agenda.title`;
  const eyebrowRegion = variant === "home" ? `${prefix}.eyebrow` : `${prefix}.agenda.eyebrow`;
  const bodyRegion = variant === "home" ? `${prefix}.body` : `${prefix}.agenda.body`;

  return (
    <section
      className={`${styles.section} ${variant === "home" ? styles.home : styles.full}`}
      data-builder-item-id={variant === "home" ? "events" : "agenda"}
      data-home-section={variant === "home" ? "events" : undefined}
      data-public-events-variant={variant}
      aria-labelledby={`${variant}-events-title`}
    >
      <div className="container">
        <header className={styles.heading}>
          <div>
            <p className="eyebrow" data-builder-region={eyebrowRegion} data-builder-kind="text">
              {localizedBuilderText(locale, eyebrowRegion, builderText(content, eyebrowRegion, "District 34 Calendar"))}
            </p>
            <h2 id={`${variant}-events-title`} data-builder-region={titleRegion} data-builder-kind="text">
              {localizedBuilderText(locale, titleRegion, builderText(content, titleRegion, "Upcoming Community Events"))}
            </h2>
          </div>
          <p data-builder-region={bodyRegion} data-builder-kind="text">
            {localizedBuilderText(locale, bodyRegion, builderText(
              content,
              bodyRegion,
              "Find upcoming public events hosted by the District 34 office.",
            ))}
          </p>
          {variant === "home" ? (
            <Link className={styles.viewAll} href="/events">
              {locale === "es" ? "Ver todos los eventos" : "View all events"}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          ) : null}
        </header>

        {calendar.status === "unavailable" ? (
          <div className={styles.state} data-calendar-state="unavailable" role="status">
            <CalendarDays aria-hidden="true" />
            <div>
              <h3 data-builder-region={`${prefix}.unavailable.title`} data-builder-kind="text">
                {localizedBuilderText(locale, `${prefix}.unavailable.title`, builderText(content, `${prefix}.unavailable.title`, "The event calendar is temporarily unavailable"))}
              </h3>
              <p data-builder-region={`${prefix}.unavailable.body`} data-builder-kind="text">
                {localizedBuilderText(locale, `${prefix}.unavailable.body`, builderText(content, `${prefix}.unavailable.body`, "Please check again later or contact the District 34 office for current event information."))}
              </p>
            </div>
          </div>
        ) : empty ? (
          <div className={styles.state} data-calendar-state="empty">
            <CalendarDays aria-hidden="true" />
            <div>
              <h3 data-builder-region={`${prefix}.empty.title`} data-builder-kind="text">
                {localizedBuilderText(locale, `${prefix}.empty.title`, builderText(content, `${prefix}.empty.title`, "No upcoming public events are posted"))}
              </h3>
              <p data-builder-region={`${prefix}.empty.body`} data-builder-kind="text">
                {localizedBuilderText(locale, `${prefix}.empty.body`, builderText(content, `${prefix}.empty.body`, "Check News & Updates or contact the District 34 office for current public information."))}
              </p>
              <div className={styles.stateActions}>
                <Link href="/news">{locale === "es" ? "Noticias y novedades" : "News & Updates"}</Link>
                <Link href="/contact">{locale === "es" ? "Contactar a la oficina" : "Contact the Office"}</Link>
              </div>
            </div>
          </div>
        ) : (
          <EventAgenda events={events} locale={locale} />
        )}
      </div>
    </section>
  );
}
