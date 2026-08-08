# Public Forms Civic Service Card Design

**Date:** 2026-08-08

**Status:** Approved design direction; complete implementation-planning input

**Project:** Official Assembly Website V2

## Objective

Redesign the live Contact and District Newsletter forms so they look and behave like intentional parts of the public website instead of browser-default controls. The approved presentation is a polished **civic service card** that uses the site's existing navy, red, green, gold, white, and soft-gray visual language.

The change must preserve the existing managed-form, Supabase, Turnstile, consent, rate-limit, idempotency, newsletter-readiness, and Resend confirmation boundaries. It is a public presentation and interaction improvement, not a new form system or provider migration.

## Existing-system findings

The public form package already emits semantic form markup:

- a form and fieldset with a legend;
- labels connected to their controls;
- native required attributes and autocomplete hints;
- field-level help and error containers;
- a Turnstile mount point;
- a disabled submitting state; and
- an ARIA live status region.

The website currently styles `.form-panel` and an older `.field` convention, while the managed package emits `.builder-public-form` and `[data-builder-form-field]` attributes. Because those package selectors have no dedicated site styles, the browser displays much of the managed form with default fieldset, input, checkbox, and button presentation.

The live Contact form is already published and compatible with the installed package revision. The previously observed unavailable panel was a stale client-side render in an already-open page, not the current production form state. The redesign does not change form readiness or provisioning.

## Approved approach

Add a site-owned presentation and interaction layer around the existing managed forms.

1. Keep `ResidentForm` as the server-side readiness and projection boundary.
2. Keep `TurnstileAwareBuilderForm` as the client-side enhancement boundary.
3. Add the civic-card structure and form-specific presentation metadata at those site-owned boundaries.
4. Style the package's existing semantic markup through `.builder-public-form` and its stable data attributes.
5. Add only the small client behaviors required for useful field feedback and Turnstile guidance.
6. Do not fork, patch, or republish `@reuben-williams/next` or `@reuben-williams/forms` for this release.

This approach fixes the actual mismatch, retains package upgradeability, and avoids creating a second form implementation.

## Alternatives considered

### CSS-only skin

CSS alone could improve colors, borders, spacing, and grid layout. It cannot fully provide the approved contextual card headings, clear optional-field indicators, and useful field-specific validation feedback without relying on brittle generated content. It is insufficient for the approved interaction design.

### Replace the managed form with page-specific JSX

A custom Contact form and Newsletter form would give complete markup control, but it would duplicate submission serialization, revision identifiers, consent evidence, Turnstile handling, completion behavior, and future package changes. This introduces unnecessary contract and security risk.

### Modify and republish the private package

The shared package could gain new presentation hooks, but these visual decisions are specific to this website. A package release would widen the change surface and couple a client-site polish task to every package consumer. Site-level adaptation is the narrower boundary.

## Visual system

### Section composition

The existing two-column public section remains:

- the left column contains the editable eyebrow, heading, explanatory copy, and any existing supporting link;
- the right column contains the managed form as an elevated civic service card; and
- the columns collapse to one column on narrow viewports.

This retains the editor's existing section and region ownership. The redesign does not replace or rename builder region identifiers.

### Card presentation

The form card uses:

- a navy context header;
- a restrained gold or green accent line;
- a white body;
- the site's existing border color;
- an 18px corner radius;
- a subtle navy-tinted shadow; and
- spacing consistent with the website's current cards and calls to action.

The visible form headings are:

- Contact: **Send a message to the District Office**
- Newsletter: **Join the District Newsletter**

The header is paired with the package fieldset and legend so the form retains a meaningful accessible name. Before rendering, the site creates an in-memory presentation clone of the public projection. That clone may change only `displayName` and each field's display-only `label`. It must preserve `formKey`, `revisionId`, field keys, field kinds, required flags, options, the complete consent object, completion mode, Turnstile configuration, and endpoint. The stored projection and published revision are never mutated.

Immediately below the heading, the card says:

> Fields marked * are required. All other fields are optional.

This note is static interface guidance, not editable page content.

### Contact field layout

The Contact form retains the published field order and configuration:

- First name — required
- Last name — required
- Email — optional
- Phone — optional
- Subject — required
- Message — required
- ZIP code — optional when present in the published projection
- Operational contact acknowledgement — required

On wide screens, compatible adjacent fields may share a two-column row. Message and acknowledgement always span the card width. The visual grid must not reorder controls differently from their DOM and keyboard order. If a projection changes its visible fields, the layout must degrade to a coherent single-column or partially filled grid without empty placeholders.

### Newsletter field layout

The Newsletter form retains:

- Email address — required
- First name — optional
- Marketing email consent — required

Email remains the primary field. The existing confirmation and privacy context appears inside the card as a compact green-tinted information panel. Its privacy link remains visible and underlined. Consent spans the card width and is presented as an explicit decision rather than fine print.

The dedicated `/newsletter` page and the embedded signup on `/news` use the same card component and submission behavior. Page-specific editable introductions remain independent.

## Interaction design

### Interactive affordances

All active buttons, links, summary controls, checkboxes, and selectable fields use an appropriate pointer or text cursor. Hover treatment must supplement, not replace, the visible control shape. Keyboard focus uses a high-contrast navy focus ring with sufficient offset so it is not clipped by the card.

Disabled submission state:

- retains readable text and contrast;
- changes the pointer to indicate the control is unavailable;
- prevents duplicate requests; and
- uses the existing **Submitting** label while a request is in flight.

Motion is limited to short color, border, and shadow transitions and is removed when `prefers-reduced-motion` is enabled.

### Required and optional indicators

Required non-consent labels retain the package's `*`. Required consent receives an equally visible required marker through the site enhancement layer. Optional text, email, phone, and ZIP labels display **Optional** as secondary label text.

Indicators are derived from the live projection and added to the labels in the in-memory presentation clone. They must not be hard-coded against a stale field list. No key, required flag, consent evidence, submitted value, or stored form configuration changes. Imperative DOM rewriting is not used for legends or label indicators.

### Validation

Native HTML validity remains authoritative for client-side field constraints. The site enhancement layer listens at the managed-form wrapper and uses each existing field error container to present a concise message for the first invalid control and any other invalid controls encountered.

Examples include:

- `Enter your first name.`
- `Enter a valid email address.`
- `Agree to the contact acknowledgement before submitting.`

On correction, the related error clears. On submission with invalid fields, focus moves to the first invalid control; on mobile it enters the viewport using non-disruptive scrolling. The wrapper writes validation feedback only into the package-provided error node referenced by the control's `aria-describedby`; it does not replace the control or its label. The implementation must not replace browser constraints with a conflicting validation schema.

Validation precedes verification. The submit-capture flow is:

1. call `form.reportValidity()`;
2. if it returns `false`, prevent the submission, retain or move focus to the first invalid control, populate its existing error node, and do not show a missing-verification error;
3. only when the form is valid, read the Turnstile token;
4. if the token is absent, prevent the submission and show the verification guidance; and
5. if the token exists, allow the package submit handler to run unchanged.

This ordering is required even in programmatic and component-test submission paths where the browser may not have performed interactive constraint validation before dispatching the submit event.

### Turnstile verification

The Turnstile widget and its status form one verification block immediately before the submit action.

- Initial guidance: verification runs automatically and should be allowed to finish.
- If a valid form is submitted before a token exists, the guard prevents submission and shows the approved loading guidance.
- If the form itself is invalid, field validation is shown first and the Turnstile warning does not replace it.
- The guidance clears after a token is detected on a later submit attempt.
- The widget remains keyboard reachable and contained at narrow widths.

This release does not change Turnstile keys, actions, server verification, or failure policy.

### Completion and error states

The package status region remains the canonical submission-result copy surface. Because the package does not expose typed callbacks, the wrapper owns a small event-derived presentation state machine; it must not parse arbitrary server message text and must not reimplement the request:

- `idle` on initial render;
- `client-invalid` after native validation prevents submission;
- `verification-needed` after a valid form is blocked for a missing Turnstile token;
- `submitting` when a valid, verified submit is allowed to reach `BuilderForm`;
- `success` when the package calls `form.reset()` after an inline success; and
- `error` when the package status changes and the submit control becomes enabled after `submitting` without an intervening reset.

The wrapper may observe only its own form's existing status node, submit-button disabled attribute, and reset event. A reset marker takes precedence over an error completion marker so React batching cannot briefly classify an accepted request as a failure. Same-site redirect completion leaves the page and requires no persistent terminal state. The wrapper exposes the resulting state through a scoped data attribute for CSS and the Newsletter guidance.

The site styles those states without changing the server response contract:

- neutral blue/gray for progress;
- green for successful acceptance;
- red for validation, stale-revision, rate-limit, or service errors.

Contact success confirms receipt without promising a response time.

Newsletter success must remain truthful about double opt-in. The approved experience explains that:

- the request is pending;
- the resident is not subscribed until the email link is opened;
- the confirmation may take several minutes; and
- spam or junk should be checked if it is not visible.

After the event-derived state reaches `success`, the Newsletter wrapper appends static delivery guidance adjacent to the live status. It must not claim that a subscription or email delivery has completed. Contact does not receive Newsletter-specific guidance.

### Unavailable state

When readiness fails closed, the existing `UnavailableFormFallback` remains authoritative. The fallback uses the same civic-card shell so the section does not visually collapse into a plain message. It includes a prominent, keyboard-accessible telephone link for the District 34 office and does not display disabled or misleading input controls.

## Responsive behavior

At desktop widths, the form card occupies the right side of the existing split layout. Its internal form may use two columns where field order remains natural.

At tablet and mobile widths:

- the section becomes a single column;
- every field becomes full width;
- gaps remain at least 16px;
- form controls and primary actions have a minimum 44px interaction height, targeting 48px where layout permits;
- consent copy wraps without reducing the checkbox target;
- Turnstile remains contained within the viewport;
- status text wraps without overflow; and
- no content causes horizontal page scrolling at 390px.

The card's mobile padding decreases without removing visual separation from the page background.

## Accessibility requirements

- Preserve the fieldset, legend, labels, described-by relationships, and live regions emitted by the managed form.
- Do not communicate required, optional, error, success, or disabled states by color alone.
- Keep visible focus treatment for every interactive element.
- Maintain readable contrast for muted instructions and disabled controls.
- Keep error messages adjacent to and programmatically associated with their fields.
- Do not use placeholder text as a substitute for a label.
- Preserve logical DOM, visual, and tab order.
- Use polite live announcements for status changes; avoid duplicate announcements from the Turnstile and submission regions.
- Ensure all controls remain usable at 200% browser zoom and at a 390px viewport.

## Component boundaries

### `ResidentForm`

`ResidentForm` continues to own:

- form-type selection;
- Supabase client and site resolution;
- Newsletter configuration and public-readiness checks;
- published-form projection loading;
- fail-closed fallback selection; and
- Turnstile script loading.

It may add form-type data attributes and presentation copy needed by the civic-card shell. It must not call provider APIs or bypass readiness.

### `TurnstileAwareBuilderForm`

This remains the only local client wrapper around the package form. It may add:

- an in-memory presentation projection that changes only `displayName` and field `label` values;
- native-validity feedback in existing error containers;
- the event-derived form-state machine and stable data attributes used for styling;
- coordinated Turnstile guidance.

It must continue to render `BuilderForm` for submission and serialization. It must not reimplement the POST request, consent payload, idempotency key, or completion redirect.

### `NewsletterSignupSection` and `PageTemplate`

These components retain their current builder region IDs and route composition. They may receive presentation classes needed for the unified card, but the `/news`, `/newsletter`, and `/contact` content ownership remains unchanged.

### Global styles

The form styles live in `app/globals.css` under a scoped public-form namespace. Selectors must target the form wrapper, `.builder-public-form`, `[data-builder-form-field]`, `[data-builder-form-status]`, `[data-turnstile-status]`, and `.cf-turnstile` without changing admin/editor form controls.

## Data, security, and provider boundaries

This release preserves:

- `/api/forms/contact` for Contact submissions;
- `/api/forms/newsletter-signup` for Newsletter signup;
- published form revision validation;
- Supabase-backed storage and strict ingestion RPCs;
- Turnstile server verification;
- site-, network-, and identity-scoped abuse controls;
- idempotency keys;
- operational and marketing consent evidence;
- Newsletter double opt-in;
- Resend confirmation jobs and webhook evidence; and
- the current fail-closed behavior.

The release does not:

- change database schemas or policies;
- change rate limits or cron frequency;
- change Resend resources, DNS, sender identity, or plan;
- send a broadcast;
- create synthetic submissions or contacts;
- promise inbox placement; or
- expose provider or Supabase secrets to client code.

## Deliverability and capacity context

The redesigned Newsletter card may explain the confirmation step, but visual changes cannot guarantee inbox placement. The currently verified sending domain should continue to be warmed gradually with authentic, confirmed subscribers, while bounces, complaints, and suppressions are monitored in Resend.

Rate-limit and delivery-capacity changes are separate operational decisions. The existing sequential worker is below Resend's API request-rate ceiling in normal operation, while the active Resend plan's daily or monthly email quota can become the first practical limit. No quota, worker, or public ingestion limit changes are included in this design.

## Error handling and edge cases

- A stale form revision continues to request a page refresh instead of silently resubmitting against a different consent contract.
- A request rejected by Turnstile, rate limiting, readiness, or storage displays the server's safe public message in the styled error state.
- A network or invalid-JSON failure displays the existing generic unavailable message; no private response data is exposed.
- A missing optional field does not reserve an empty visual column.
- A changed published form projection automatically receives the base card styles and derived required/optional indicators.
- If JavaScript is delayed, labels and native required constraints remain understandable, and the server boundary remains authoritative.
- The unavailable fallback remains usable without Turnstile or client JavaScript.
- The newsletter confirmation email delay guidance must not be displayed as proof of delivery.

## Test-driven implementation strategy

Implementation begins with failing tests and proceeds in small presentation and behavior slices.

### Component tests

1. Contact renders the civic-card identity and the live managed form endpoint when its projection is ready.
2. Newsletter renders the civic-card identity, confirmation/privacy context, and the live Newsletter endpoint when readiness is satisfied.
3. Both retain builder region ownership and exactly one managed form.
4. Unavailable Contact and Newsletter states render the styled fallback and telephone path without a submit button.
5. Required and optional indicators reflect the projection rather than a hard-coded route field list.
6. Native invalid events populate the correct existing error region and focus the first invalid control before Turnstile gating occurs.
7. Correcting a field clears its local error.
8. Turnstile prevents premature submission and keeps a single useful status announcement.
9. State-machine tests prove reset means success, completion without reset means error, reset wins over a batched completion observer, and no branch parses response-message text or duplicates the package request.
10. Newsletter accepted state includes pending-confirmation, several-minute, and spam-folder guidance without claiming subscription completion.

### Styling contract tests

Styles must cover:

- `.builder-public-form` and its fieldset/legend;
- all `[data-builder-form-field]` controls;
- consent controls;
- active, hover, focus-visible, disabled, invalid, progress, success, and error states;
- Turnstile and its status;
- unavailable fallback;
- wide and narrow form grids; and
- reduced-motion behavior.

Tests should assert stable class and data-attribute contracts, not pixel values for every declaration.

### Regression tests

- Existing public form ingestion tests continue to pass unchanged.
- Existing Newsletter readiness, consent, confirmation, worker, and Resend tests continue to pass unchanged.
- Contact and Survey readiness behavior remains fail closed.
- Admin and editor workspace controls are unaffected by public-form selectors.
- No editor content IDs or page routes change.

## Verification and release

### Automated gates

Run:

1. focused new form-component tests;
2. existing Contact, Newsletter, Turnstile, public route, and builder mapping tests;
3. the complete Vitest suite;
4. lint;
5. the production build; and
6. existing boundary or database checks if an implementation unexpectedly touches those files.

### Browser QA

Verify on both `/contact` and `/newsletter`, plus the embedded signup on `/news`:

- desktop layout and visual hierarchy;
- 390px containment and touch targets;
- keyboard traversal and focus visibility;
- required and optional indicators;
- invalid-field placement and correction;
- Turnstile containment and guidance;
- submit progress and disabled state;
- success and safe error styling;
- fallback styling under mocked or controlled unavailable readiness;
- no relevant console errors;
- no failed static assets; and
- no horizontal overflow.

Browser QA before production may use mocked response states but must not create synthetic production submissions.

### Production verification

After a fresh Vercel production deployment:

1. verify the canonical pages render the civic service cards;
2. verify the live forms and Turnstile load without submitting them;
3. verify headers, assets, and console/network behavior;
4. have the owner perform one authentic Contact submission;
5. have the owner perform one authentic Newsletter signup and complete double opt-in; and
6. verify the authentic records and confirmation evidence through the existing dashboards.

No automated or synthetic production submission is authorized by this design.

## Rollback

The presentation can be rolled back by reverting the site-owned component and CSS commit and redeploying. Because the release does not change form revisions, database schemas, provider resources, or stored submissions, no data rollback is required.

## Non-goals

- Redesigning private editor or growth dashboards
- Replacing the managed form package
- Adding a new Contact or Newsletter schema
- Changing staff notifications or response workflows
- Changing Resend plan, sender, DNS, or reputation controls
- Changing form rate limits or worker frequency
- Adding synthetic production data
- Redesigning Survey, which remains separately governed and unavailable
- Guaranteeing inbox placement or a response time from the District Office

## Acceptance criteria

The design is complete when:

1. Contact and Newsletter use one coherent civic service card language that matches the public website.
2. Every visible field clearly communicates whether it is required or optional.
3. Field errors, Turnstile guidance, progress, success, failure, and unavailable states are understandable and accessible.
4. Contact and Newsletter layouts remain contained and operable at 390px and 200% zoom.
5. The same managed projections, endpoints, consent evidence, Turnstile verification, storage, rate limiting, double opt-in, and provider boundaries remain intact.
6. Editor regions and route behavior remain unchanged.
7. Tests, lint, production build, and browser QA pass.
8. Production verification uses only owner-authorized authentic submissions.
