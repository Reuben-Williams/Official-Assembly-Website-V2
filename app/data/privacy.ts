import { siteConfig } from "./site";

export const privacyNotice = Object.freeze({
  title: "Privacy notice",
  updated: "August 6, 2026",
  introduction:
    `This notice explains how ${siteConfig.officeName} handles information submitted through this website, including District Newsletter requests.`,
  sections: Object.freeze([
    Object.freeze({
      title: "Information we collect",
      paragraphs: Object.freeze([
        "The newsletter form collects your email address, an optional first name, and the required marketing-email consent selection.",
        "We also keep limited confirmation, delivery, unsubscribe, suppression, security, and audit records needed to operate the newsletter and honor your choices. We do not retain raw Resend webhook bodies."
      ])
    }),
    Object.freeze({
      title: "How newsletter information is used",
      paragraphs: Object.freeze([
        "We use newsletter information to request confirmation, deliver District Newsletter email after confirmation, manage subscriber preferences, protect the signup process, and investigate delivery or consent issues.",
        "Submitting the form creates a pending confirmation request. It does not create an active subscription."
      ])
    }),
    Object.freeze({
      title: "Email delivery through Resend",
      paragraphs: Object.freeze([
        "Resend processes contact and delivery data for confirmation emails and District Newsletter delivery. This may include your email address, optional first name, provider contact identifiers, and delivery-event information.",
        "Resend also applies unsubscribe and suppression controls during delivery."
      ])
    }),
    Object.freeze({
      title: "Confirmation and unsubscribe choices",
      paragraphs: Object.freeze([
        "You are not subscribed until you deliberately complete the confirmation step sent to your inbox.",
        "Each District Newsletter includes an unsubscribe link. Using it stops future District Newsletter marketing email. You may also contact the district office for help with a subscription choice."
      ])
    }),
    Object.freeze({
      title: "Access, correction, and deletion requests",
      paragraphs: Object.freeze([
        `To ask to access, correct, or delete newsletter information, use the contact page or call ${siteConfig.phoneDisplay}. The office reviews requests against the applicable records, consent, suppression, and retention requirements.`,
        "Approved deletion removes or irreversibly redacts direct personal information where the operating policy permits, while preserving the minimum non-message evidence needed to honor an unsubscribe or suppression."
      ])
    }),
    Object.freeze({
      title: "Retention approach",
      paragraphs: Object.freeze([
        "Pending newsletter requests expire after 30 days. Personal information is otherwise kept while a subscription is active or while it is needed to operate, secure, and audit the newsletter.",
        "Withdrawal stops future marketing use. Minimum non-message consent, unsubscribe, suppression, and audit evidence may be retained so the office can continue honoring the choice and protect the system."
      ])
    })
  ])
});
