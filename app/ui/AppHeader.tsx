import Link from "next/link";
import { Landmark, Menu } from "lucide-react";

import { pages, siteConfig } from "../data/site";
import { LanguageToggle } from "./LanguageToggle";

const navPages = pages.filter((page) =>
  ["/", "/about", "/resources", "/news", "/community", "/voting"].includes(page.href)
);

function NavigationLinks({ instance, all = false }: { instance: string; all?: boolean }) {
  const entries = all ? pages : navPages;
  return (
    <>
      {entries.map((page) => {
        const slug = page.slug ?? "home";
        return (
          <Link
            data-builder-instance={instance}
            data-builder-item-id={slug}
            data-builder-kind="link"
            data-builder-region={`global.navigation.${slug}.link`}
            href={page.href}
            key={page.href}
          >
            <span
              data-builder-instance={instance}
              data-builder-kind="text"
              data-builder-link-label
              data-builder-region={`global.navigation.${slug}.label`}
            >
              {page.navLabel}
            </span>
          </Link>
        );
      })}
    </>
  );
}

export function AppHeader() {
  return (
    <header className="site-header">
      <div className="container">
        <div className="nav-shell">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              <Landmark size={24} />
            </span>
            <span data-builder-region="global.header.brand" data-builder-kind="text">
              {siteConfig.officeName}
            </span>
          </Link>

          <nav
            aria-label="Primary navigation"
            className="nav-links"
            data-builder-instance="desktop"
            data-builder-kind="sections"
            data-builder-region="global.navigation"
          >
            <NavigationLinks instance="desktop" />
          </nav>

          <div className="header-actions">
            <LanguageToggle />
            <Link
              className="cta-link nav-cta"
              data-builder-kind="link"
              data-builder-region="global.header.contact"
              href="/contact"
            >
              <span data-builder-link-label data-i18n-key="global.contact">Contact Office</span>
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
              <NavigationLinks all instance="mobile" />
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
