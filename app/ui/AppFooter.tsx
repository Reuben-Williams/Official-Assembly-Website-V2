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
          <h3>Demo Routes</h3>
          {pages.slice(0, 5).map((page) => (
            <p key={page.href}>
              <Link href={page.href}>{page.navLabel}</Link>
            </p>
          ))}
        </div>
        <div>
          <h3>Deployment</h3>
          <p>GitHub Pages static export is configured.</p>
          <p>Vercel and Supabase environment scaffolding is ready.</p>
        </div>
      </div>
    </footer>
  );
}
