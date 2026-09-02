import Image from "next/image";
import { ArrowUpRight, FileText, Users } from "lucide-react";

import { districtConnections } from "../data/district-connections";
import { localizedBuilderText } from "../i18n/catalog.server";
import type { PublicLocale } from "../i18n/locale";
import {
  builderText,
  type BuilderServerContent
} from "../../lib/builder/server-content";
import { parseSafePublicUrl } from "../../lib/public-links/safe-public-url";
import styles from "./constituent-action-sections.module.css";

type SectionProps = {
  content: BuilderServerContent;
  locale: PublicLocale;
};

function currentResourceDestination(content: BuilderServerContent) {
  const value = content.regions["resources.current-resource.destination"];
  if (value?.type !== "link" || value.disabled || !value.href) return null;

  try {
    return { href: parseSafePublicUrl(value.href), label: value.label };
  } catch {
    return null;
  }
}

export function CurrentResourceSection({ content, locale }: SectionProps) {
  const flyer = content.regions["media.current-resource-flyer"];
  const hasFlyer = flyer?.type === "image" && Boolean(flyer.src);
  const destination = currentResourceDestination(content);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const flyerSrc = hasFlyer && flyer.src.startsWith("/") ? `${basePath}${flyer.src}` : hasFlyer ? flyer.src : "";

  return (
    <section className={styles.resourceSection} data-builder-item-id="current-resource">
      <div className={`container ${styles.resourceShell}`}>
        <div className={styles.resourceCopy}>
          <span className={styles.sectionIcon}><FileText aria-hidden="true" /></span>
          <p
            className="eyebrow"
            data-builder-region="resources.current-resource.eyebrow"
            data-builder-kind="text"
          >
            {localizedBuilderText(locale, "resources.current-resource.eyebrow", builderText(
              content,
              "resources.current-resource.eyebrow",
              "Current District Resource"
            ))}
          </p>
          <h2 data-builder-region="resources.current-resource.title" data-builder-kind="text">
            {localizedBuilderText(locale, "resources.current-resource.title", builderText(
              content,
              "resources.current-resource.title",
              "Current office flyer and public information"
            ))}
          </h2>
          <p data-builder-region="resources.current-resource.body" data-builder-kind="text">
            {localizedBuilderText(locale, "resources.current-resource.body", builderText(
              content,
              "resources.current-resource.body",
              "When the district office publishes a current resource flyer, it will appear here."
            ))}
          </p>
          {destination ? (
            <a
              className={styles.primaryAction}
              data-builder-region="resources.current-resource.destination"
              data-builder-kind="link"
              href={destination.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span data-builder-link-label>
                {localizedBuilderText(locale, "resources.current-resource.destination.label", destination.label)}
              </span>
              <ArrowUpRight aria-hidden="true" />
            </a>
          ) : null}
        </div>

        {hasFlyer ? (
          <div
            className={styles.flyer}
            data-builder-region="media.current-resource-flyer"
            data-builder-kind="image"
          >
            <Image
              src={flyerSrc}
              alt={localizedBuilderText(
                locale,
                "media.current-resource-flyer.alt",
                flyer.alt || "Current District 34 public resource flyer"
              )}
              fill
              sizes="(max-width: 800px) 100vw, 44vw"
            />
          </div>
        ) : (
          <div className={styles.emptyResource} data-resource-state="empty">
            <FileText aria-hidden="true" />
            <strong>{localizedBuilderText(
              locale,
              "resources.current-resource.empty.title",
              "No current district resource flyer is posted."
            )}</strong>
            <p>{localizedBuilderText(
              locale,
              "resources.current-resource.empty.body",
              "Use the verified resources below or contact the district office for current assistance."
            )}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function VolunteerPortalSection({ content, locale }: SectionProps) {
  const volunteerUrl = parseSafePublicUrl(districtConnections.volunteer.href);

  return (
    <section className={styles.volunteerSection} data-builder-item-id="volunteer-portal">
      <div className={`container ${styles.volunteerShell}`}>
        <span className={styles.sectionIcon}><Users aria-hidden="true" /></span>
        <div>
          <p
            className="eyebrow"
            data-builder-region="community.volunteer.eyebrow"
            data-builder-kind="text"
          >
            {localizedBuilderText(locale, "community.volunteer.eyebrow", builderText(
              content,
              "community.volunteer.eyebrow",
              "Community Volunteer Portal"
            ))}
          </p>
          <h2 data-builder-region="community.volunteer.title" data-builder-kind="text">
            {localizedBuilderText(locale, "community.volunteer.title", builderText(
              content,
              "community.volunteer.title",
              districtConnections.volunteer.title
            ))}
          </h2>
          <p data-builder-region="community.volunteer.body" data-builder-kind="text">
            {localizedBuilderText(locale, "community.volunteer.body", builderText(
              content,
              "community.volunteer.body",
              districtConnections.volunteer.english
            ))}
          </p>
          <p className={styles.externalNote}>
            {localizedBuilderText(
              locale,
              "community.volunteer.external-note",
              "This volunteer form is operated by Google Forms and opens in a new tab."
            )}
          </p>
        </div>
        <a className={styles.primaryAction} href={volunteerUrl} target="_blank" rel="noopener noreferrer">
          <span>{localizedBuilderText(locale, "community.volunteer.open", "Open volunteer form")}</span>
          <ArrowUpRight aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
