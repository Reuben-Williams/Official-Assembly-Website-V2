import { LockKeyhole } from "lucide-react";
import Link from "next/link";

import { pages, siteConfig } from "../data/site";
import {
  builderLink,
  builderSectionIds,
  builderText,
  type BuilderServerContent,
} from "../../lib/builder/server-content";

const EMPTY_CONTENT: BuilderServerContent = { regions: {} };

export function AppFooter({ content = EMPTY_CONTENT }: { content?: BuilderServerContent }) {
  const pagesBySlug = new Map(pages.map((page) => [page.slug ?? "home", page]));
  const footerPages = builderSectionIds(
    content,
    "global.navigation",
    pages.slice(0, 5).map((page) => page.slug ?? "home"),
  ).slice(0, 5).flatMap((slug) => pagesBySlug.get(slug) ?? []);
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <h2 data-builder-region="global.office.name" data-builder-kind="text">
            {builderText(content, "global.office.name", siteConfig.officeName)}
          </h2>
          <p data-builder-region="global.office.tagline" data-builder-kind="text">
            {builderText(content, "global.office.tagline", siteConfig.tagline)}
          </p>
        </div>
        <div>
          <h3 data-builder-region="global.footer.sections-title" data-builder-kind="text">
            {builderText(content, "global.footer.sections-title", "Site Sections")}
          </h3>
          <div
            data-builder-instance="footer"
            data-builder-kind="sections"
            data-builder-region="global.navigation"
          >
            {footerPages.map((page) => {
              const slug = page.slug ?? "home";
              const link = builderLink(content, `global.navigation.${slug}.link`, {
                href: page.href,
                label: page.navLabel,
              });
              return (
                <p data-builder-item-id={slug} key={page.href}>
                  <Link
                    data-builder-instance="footer"
                    data-builder-kind="link"
                    data-builder-region={`global.navigation.${slug}.link`}
                    href={link.href}
                  >
                    <span
                      data-builder-instance="footer"
                      data-builder-kind="text"
                      data-builder-link-label
                      data-builder-region={`global.navigation.${slug}.label`}
                    >
                      {builderText(content, `global.navigation.${slug}.label`, link.label)}
                    </span>
                  </Link>
                </p>
              );
            })}
          </div>
        </div>
        <div>
          <h3 data-builder-region="global.footer.access-title" data-builder-kind="text">
            {builderText(content, "global.footer.access-title", "Office Access")}
          </h3>
          <p data-builder-region="global.footer.access-body" data-builder-kind="text">
            {builderText(content, "global.footer.access-body", siteConfig.officeAddress)}
          </p>
          <p data-builder-region="global.footer.communication-body" data-builder-kind="text">
            {builderText(
              content,
              "global.footer.communication-body",
              `Call ${siteConfig.phoneDisplay} for district office assistance.`,
            )}
          </p>
          <p className="footer-policy-link"><Link href="/privacy">Privacy</Link></p>
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
