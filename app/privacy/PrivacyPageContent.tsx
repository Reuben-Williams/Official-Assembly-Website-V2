import Link from "next/link";

import { privacyNoticeFor } from "../data/privacy";
import { siteConfig } from "../data/site";
import type { PublicLocale } from "../i18n/locale";

export function PrivacyPageContent({ locale }: { readonly locale: PublicLocale }) {
  const notice = privacyNoticeFor(locale);
  const spanish = locale === "es";
  return (
    <article className="privacy-page">
      <header className="privacy-hero">
        <div className="container privacy-container">
          <p className="eyebrow">{spanish ? "Sitio web y Boletín del distrito" : "Website and District Newsletter"}</p>
          <h1>{notice.title}</h1>
          <p className="lead">{notice.introduction}</p>
          <p className="privacy-updated">{spanish ? "Última actualización" : "Last updated"} {notice.updated}</p>
        </div>
      </header>
      <div className="container privacy-container privacy-sections">
        {notice.sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
        <aside className="privacy-contact" aria-label={spanish ? "Opciones de contacto sobre privacidad" : "Privacy contact options"}>
          <h2>{spanish ? "Comuníquese con la oficina del distrito" : "Contact the district office"}</h2>
          <p>{spanish ? "Puede enviar preguntas y solicitudes mediante la página pública de contacto o por teléfono." : "Questions and requests can be submitted through the public contact page or by phone."}</p>
          <div>
            <Link className="cta-link" href="/contact">{spanish ? "Abrir la página de contacto" : "Open contact page"}</Link>
            <a className="secondary-link" href={`tel:${siteConfig.phoneE164}`}>{spanish ? "Llamar al" : "Call"} {siteConfig.phoneDisplay}</a>
          </div>
        </aside>
      </div>
    </article>
  );
}
