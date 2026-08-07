import Link from "next/link";
import { Landmark, Menu } from "lucide-react";

import { pages, siteConfig } from "../data/site";
import { LanguageToggle } from "./LanguageToggle";
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
}: {
  instance: string;
  all?: boolean;
  content: BuilderServerContent;
}) {
  const fallbackEntries = all ? pages : navPages;
  const entriesBySlug = new Map(pages.map((page) => [page.slug ?? "home", page]));
  const entries = builderSectionIds(
    content,
    "global.navigation",
    fallbackEntries.map((page) => page.slug ?? "home"),
  ).flatMap((slug) => entriesBySlug.get(slug) ?? []);
  return (
    <>
      {entries.map((page) => {
        const slug = page.slug ?? "home";
        const link = builderLink(content, `global.navigation.${slug}.link`, {
          href: page.href,
          label: page.navLabel,
        });
        return (
          <Link
            data-builder-instance={instance}
            data-builder-item-id={slug}
            data-builder-kind="link"
            data-builder-region={`global.navigation.${slug}.link`}
            href={link.href}
            key={page.href}
          >
            <span
              data-builder-instance={instance}
              data-builder-kind="text"
              data-builder-link-label
              data-builder-region={`global.navigation.${slug}.label`}
            >
              {builderText(content, `global.navigation.${slug}.label`, link.label)}
            </span>
          </Link>
        );
      })}
    </>
  );
}

export function AppHeader({ content = EMPTY_CONTENT }: { content?: BuilderServerContent }) {
  const contact = builderLink(content, "global.header.contact", {
    href: "/contact",
    label: "Contact Office",
  });
  return (
    <header className="site-header">
      <div className="container">
        <div className="nav-shell">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              <Landmark size={24} />
            </span>
            <span data-builder-region="global.header.brand" data-builder-kind="text">
              {builderText(content, "global.header.brand", siteConfig.officeName)}
            </span>
          </Link>

          <nav
            aria-label="Primary navigation"
            className="nav-links"
            data-builder-instance="desktop"
            data-builder-kind="sections"
            data-builder-region="global.navigation"
          >
            <NavigationLinks content={content} instance="desktop" />
          </nav>

          <div className="header-actions">
            <LanguageToggle />
            <Link
              className="cta-link nav-cta"
              data-builder-kind="link"
              data-builder-region="global.header.contact"
              href={contact.href}
            >
              <span data-builder-link-label data-i18n-key="global.contact">{contact.label}</span>
            </Link>
          </div>

          <details className="mobile-menu">
            <summary className="mobile-summary" aria-label="Open menu">
              <Menu size={24} />
            </summary>
            <nav
              aria-label="Mobile navigation"
              className="mobile-panel"
              data-builder-instance="mobile"
              data-builder-kind="sections"
              data-builder-region="global.navigation"
            >
              <NavigationLinks all content={content} instance="mobile" />
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
