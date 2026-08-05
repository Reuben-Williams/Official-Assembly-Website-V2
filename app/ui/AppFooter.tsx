import { LockKeyhole } from "lucide-react";
import Link from "next/link";

import { pages, siteConfig } from "../data/site";

export function AppFooter() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <h2 data-builder-region="global.office.name" data-builder-kind="text">
            {siteConfig.officeName}
          </h2>
          <p data-builder-region="global.office.tagline" data-builder-kind="text">
            {siteConfig.tagline}
          </p>
        </div>
        <div>
          <h3 data-builder-region="global.footer.sections-title" data-builder-kind="text">
            Site Sections
          </h3>
          <div
            data-builder-instance="footer"
            data-builder-kind="sections"
            data-builder-region="global.navigation"
          >
            {pages.slice(0, 5).map((page) => {
              const slug = page.slug ?? "home";
              return (
                <p data-builder-item-id={slug} key={page.href}>
                  <Link
                    data-builder-instance="footer"
                    data-builder-kind="link"
                    data-builder-region={`global.navigation.${slug}.link`}
                    href={page.href}
                  >
                    <span
                      data-builder-instance="footer"
                      data-builder-kind="text"
                      data-builder-link-label
                      data-builder-region={`global.navigation.${slug}.label`}
                    >
                      {page.navLabel}
                    </span>
                  </Link>
                </p>
              );
            })}
          </div>
        </div>
        <div>
          <h3 data-builder-region="global.footer.access-title" data-builder-kind="text">
            Office Access
          </h3>
          <p data-builder-region="global.footer.access-body" data-builder-kind="text">
            {siteConfig.officeAddress}
          </p>
          <p data-builder-region="global.footer.communication-body" data-builder-kind="text">
            Call {siteConfig.phoneDisplay} for district office assistance.
          </p>
          <Link
            className="staff-portal-link"
            data-staff-portal="true"
            href="/admin/login?returnTo=%2Fadmin%2Feditor"
          >
            <LockKeyhole aria-hidden="true" size={16} />
            <span>Staff Portal</span>
          </Link>
        </div>
      </div>
    </footer>
  );
}
