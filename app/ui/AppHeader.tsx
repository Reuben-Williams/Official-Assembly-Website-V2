import Link from "next/link";
import { Bell, Landmark, Menu } from "lucide-react";

import { pages, siteConfig } from "../data/site";

const navPages = pages.filter((page) =>
  ["/", "/about", "/resources", "/news", "/community", "/voting"].includes(
    page.href
  )
);

export function AppHeader() {
  return (
    <>
      <div className="demo-bar">
        <div className="container">
          <Bell size={18} aria-hidden="true" />
          <span>{siteConfig.demoNotice}</span>
        </div>
      </div>
      <header className="site-header">
        <div className="container">
          <div className="nav-shell">
            <Link className="brand" href="/">
              <span className="brand-mark" aria-hidden="true">
                <Landmark size={24} />
              </span>
              <span>{siteConfig.officeName}</span>
            </Link>

            <nav className="nav-links" aria-label="Primary navigation">
              {navPages.map((page) => (
                <Link key={page.href} href={page.href}>
                  {page.navLabel}
                </Link>
              ))}
            </nav>

            <Link className="cta-link nav-cta" href="/contact">
              Contact Office
            </Link>

            <details className="mobile-menu">
              <summary className="mobile-summary" aria-label="Open menu">
                <Menu size={24} />
              </summary>
              <nav className="mobile-panel" aria-label="Mobile navigation">
                {pages.map((page) => (
                  <Link key={page.href} href={page.href}>
                    {page.navLabel}
                  </Link>
                ))}
              </nav>
            </details>
          </div>
        </div>
      </header>
    </>
  );
}
