import Link from "next/link";
import { Landmark } from "lucide-react";

import { pages, siteConfig } from "../data/site";
import { LanguageToggle } from "./LanguageToggle";
import { localizedNavigationLabel, publicCopy } from "../i18n/catalog.public";
import type { PublicLocale } from "../i18n/locale";
import { MobileNavigation, type MobileNavigationItem } from "./MobileNavigation";
import {
  builderLink,
  builderSectionIds,
  builderText,
  type BuilderServerContent,
} from "../../lib/builder/server-content";

const navPages = pages.filter((page) =>
  ["/", "/about", "/resources", "/news", "/community", "/voting"].includes(page.href)
);

const EMPTY_CONTENT: BuilderServerContent = { regions: {} };

function NavigationLinks({
  instance,
  all = false,
  content,
  locale,
}: {
  instance: string;
  all?: boolean;
  content: BuilderServerContent;
  locale: PublicLocale;
}) {
  const entries = navigationEntries({ all, content, locale });
  return (
    <>
      {entries.map((entry) => (
        <Link
          data-builder-instance={instance}
          data-builder-item-id={entry.slug}
          data-builder-kind="link"
          data-builder-region={`global.navigation.${entry.slug}.link`}
          href={entry.href}
          key={entry.slug}
        >
          <span
            data-builder-instance={instance}
            data-builder-kind="text"
            data-builder-link-label
            data-builder-region={`global.navigation.${entry.slug}.label`}
          >
            {entry.label}
          </span>
        </Link>
      ))}
    </>
  );
}

function navigationEntries({
  all = false,
  content,
  locale,
}: {
  all?: boolean;
  content: BuilderServerContent;
  locale: PublicLocale;
}): MobileNavigationItem[] {
  const fallbackEntries = all ? pages : navPages;
  const entriesBySlug = new Map(pages.map((page) => [page.slug ?? "home", page]));
  return builderSectionIds(
    content,
    "global.navigation",
    fallbackEntries.map((page) => page.slug ?? "home"),
  ).flatMap((slug) => {
    const page = entriesBySlug.get(slug);
    if (!page) return [];
    const link = builderLink(content, `global.navigation.${slug}.link`, {
      href: page.href,
      label: page.navLabel,
    });
    return [{
      slug,
      href: link.href,
      label: localizedNavigationLabel(
        locale,
        slug,
        builderText(content, `global.navigation.${slug}.label`, link.label),
      ),
    }];
  });
}

export function AppHeader({
  content = EMPTY_CONTENT,
  locale = "en",
}: {
  content?: BuilderServerContent;
  locale?: PublicLocale;
}) {
  const contact = builderLink(content, "global.header.contact", {
    href: "/contact",
    label: "Contact Office",
  });
  const brandLabel = builderText(content, "global.header.brand", siteConfig.officeName);
  const mobileNavigationLabel = publicCopy(locale, "global.header.mobile-navigation", "Mobile navigation");
  return (
    <header className="site-header" lang={locale}>
      <div className="container">
        <div className="nav-shell">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              <Landmark size={24} />
            </span>
            <span data-builder-region="global.header.brand" data-builder-kind="text">
              {brandLabel}
            </span>
          </Link>

          <nav
            aria-label={publicCopy(locale, "global.header.primary-navigation", "Primary navigation")}
            className="nav-links"
            data-builder-instance="desktop"
            data-builder-kind="sections"
            data-builder-region="global.navigation"
          >
            <NavigationLinks content={content} instance="desktop" locale={locale} />
          </nav>

          <div className="header-actions">
            <LanguageToggle locale={locale} />
            <Link
              className="cta-link nav-cta"
              data-builder-kind="link"
              data-builder-region="global.header.contact"
              href={contact.href}
            >
              <span data-builder-link-label data-i18n-key="global.contact">
                {publicCopy(locale, "global.header.contact", contact.label)}
              </span>
            </Link>
          </div>

          <MobileNavigation
            brandLabel={brandLabel}
            closeLabel={publicCopy(locale, "global.header.close-menu", "Close menu")}
            items={navigationEntries({ all: true, content, locale })}
            navigationLabel={mobileNavigationLabel}
            openLabel={publicCopy(locale, "global.header.open-menu", "Open menu")}
          />
        </div>
      </div>
    </header>
  );
}
