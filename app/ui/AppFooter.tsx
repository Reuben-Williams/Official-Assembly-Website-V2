import Link from "next/link";

import { pages, siteConfig } from "../data/site";

export function AppFooter() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <h2>{siteConfig.officeName}</h2>
          <p>{siteConfig.tagline}</p>
        </div>
        <div>
          <h3>Site Sections</h3>
          {pages.slice(0, 5).map((page) => (
            <p key={page.href}>
              <Link href={page.href}>{page.navLabel}</Link>
            </p>
          ))}
        </div>
        <div>
          <h3>Office Access</h3>
          <p>Residents can find resources, updates, and contact options.</p>
          <p>Content is organized for clear public communication.</p>
        </div>
      </div>
    </footer>
  );
}
