"use client";

import type { ReactNode } from "react";
import Link from "next/link";

type Role = "owner" | "editor" | "contributor" | "viewer";

const forms = [
  {
    key: "contact",
    title: "Contact the District Office",
    route: "/contact",
    endpoint: "/api/forms/contact",
    fields: "First name, last name, subject, and message are required. Email, phone, and ZIP code are optional.",
    consent: "Operational contact consent is required so the office can respond by the supplied channel.",
    lifecycle: "Submission → identity/customer → eligible Lead → Overview",
    destination: "Every accepted request appears in Submissions. Identity resolution creates or updates the customer record; eligible contact intake can create a Lead and update Overview totals.",
  },
  {
    key: "newsletter",
    title: "District Newsletter",
    route: "/newsletter",
    endpoint: "/api/forms/newsletter-signup",
    fields: "Email, optional first name, and required marketing email consent.",
    consent: "The resident must explicitly request marketing email and then confirm through the email sent by Resend.",
    lifecycle: "Pending confirmation → confirmed subscription → active subscriber",
    destination: "A confirmed signup becomes an active newsletter subscriber and is synchronized to the approved Resend audience. Newsletter signup does not create a lead.",
  },
] as const;

export function FormsGuidanceWorkspace({
  role,
  newsletterOperations,
}: {
  role: Role;
  newsletterOperations: ReactNode;
}) {
  return (
    <section className="forms-guidance" data-forms-guidance-workspace>
      <header className="forms-guidance-hero">
        <div>
          <p className="forms-guidance-eyebrow">Managed forms · live production</p>
          <h1>Forms and authentic testing</h1>
          <p>Review what each public form collects, where accepted records go, and how to test the real workflow without placeholder data.</p>
        </div>
        <span>Request-time verified</span>
      </header>

      <div className="managed-form-grid">
        {forms.map((form) => (
          <article key={form.key} data-managed-form-card={form.key}>
            <div className="managed-form-title">
              <div><small>Managed production route</small><h2>{form.title}</h2></div>
              <strong>Guarded live form</strong>
            </div>
            <dl>
              <div><dt>Public route</dt><dd><code>{form.route}</code></dd></div>
              <div><dt>Submission endpoint</dt><dd><code>{form.endpoint}</code></dd></div>
              <div><dt>Collected data</dt><dd>{form.fields}</dd></div>
              <div><dt>Consent path</dt><dd>{form.consent}</dd></div>
              <div><dt>Record lifecycle</dt><dd><strong>{form.lifecycle}</strong><span>{form.destination}</span></dd></div>
            </dl>
            <div className="managed-form-actions">
              <a href={form.route} rel="noreferrer" target="_blank">Open public form</a>
              <Link href="/admin/editor?workspace=website.submissions">Review submissions</Link>
              {form.key === "newsletter" ? <a href="#newsletter-live-operations">Newsletter operations</a> : null}
            </div>
          </article>
        ))}
      </div>

      <section className="authentic-test-checklist" id="authentic-live-form-checklist" aria-labelledby="authentic-live-form-checklist-title">
        <div>
          <p className="forms-guidance-eyebrow">Manual and controlled</p>
          <h2 id="authentic-live-form-checklist-title">Controlled live-data checklist</h2>
          <p>This checklist never fills or submits a form, seeds a record, or calls an email, SMS, or AI provider. Each action is performed deliberately by an authorized person.</p>
        </div>
        <ol>
          <li>Open the Contact or Newsletter public route in a separate tab.</li>
          <li>Use contact information you control, review every value, complete Turnstile, and submit once.</li>
          <li>Return to Submissions and locate the new live record. Contact intake can then appear in Customers, eligible Leads, and Overview.</li>
          <li>For Newsletter, open the received confirmation email and confirm it; only then verify the active subscriber state.</li>
          <li>Remove or retain the record according to the office’s approved data-handling procedure after the check.</li>
        </ol>
        <p className="provider-boundary">
          Resend handles approved newsletter email. SMS and AI actions remain unavailable because those providers are not configured.
          {role === "viewer" ? " Your current role is read-only in operational workspaces." : " No provider action runs from this checklist."}
        </p>
      </section>

      {newsletterOperations ? <section id="newsletter-live-operations">{newsletterOperations}</section> : null}
    </section>
  );
}
