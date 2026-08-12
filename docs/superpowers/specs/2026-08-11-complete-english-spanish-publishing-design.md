# Complete English-Spanish Publishing Design

Date: 2026-08-11

Status: Approved design; specification pending final user review

Website: `official-assembly-website-v2`
Shared platform: `site-editor-platform`

## 1. Objective

Replace the public site's partial DOM translation behavior with a complete, reviewed bilingual publishing system.

English remains the source language. Every public-facing translatable value must have an approved Spanish counterpart before its containing page, post, alert, form, or other record can publish. The navbar language control must switch the entire public experience on the same route, preserve the visitor's selection, and render the selected language on the server before first paint.

The same rule must apply to content created after launch. A future editor cannot accidentally publish a new English-only field, post, alert, image description, form message, or metadata value.

## 2. Approved decisions

- Use separate reviewed English and Spanish values rather than live browser translation.
- English is the canonical source language.
- Staff may write Spanish manually or request an optional generated Spanish draft.
- Generated text is always marked `needs_review`; a provider can never approve or publish its own output.
- Publishing is blocked until every required Spanish value is approved or explicitly approved as language-neutral.
- Editing English invalidates the corresponding Spanish approval.
- Language-neutral treatment is explicit and audited for proper names, addresses, phone numbers, official titles, dates, identifiers, and similar values.
- URL targets and other structural non-language data are not duplicated; their visible labels and accessibility text remain translatable.
- Both languages and their approval history are versioned and restorable.
- The public site uses the same route for both languages and persists the chosen language in a first-party cookie.
- Existing content is inventoried and backfilled before the strict production publishing gate is activated.
- No translation provider is activated by this design. Manual Spanish entry remains fully functional when no provider is configured.

## 3. Scope

### 3.1 Public surfaces included

The bilingual contract covers all visitor-visible or visitor-announced content owned by this website:

- Global navigation, footer, alerts, buttons, links, skip links, labels, and accessible names
- Every public page, including the homepage, News & Updates, newsletter, contact, community, resources, voting, social, privacy, confirmation states, and the 404 page
- Editor-managed text regions and link labels
- Page titles, descriptions, eyebrow copy, cards, timelines, captions, and calls to action
- Published post titles, excerpts, bodies, categories when displayed as copy, link labels, image alt text, captions, and metadata
- Alert messages and visible or accessible link labels
- Form headings, field labels, placeholders, help text, option labels, consent wording, verification guidance, validation errors, pending states, success states, and failure states
- Newsletter confirmation pages and public newsletter emails selected by the subscriber's locale
- Image alt text and captions
- Public SEO title, description, Open Graph text, and other textual metadata
- Empty, loading, unavailable, and error states
- Screen-reader-only status announcements

### 3.2 Private editor scope

The Staff Portal remains an English-language application in this release. It gains bilingual authoring, status, review, preview, and validation controls, but translating all private editor chrome is a separate project. This boundary does not weaken the rule for any content published to the public site.

### 3.3 Non-translatable values

The following are structural and are stored once rather than translated:

- Stable IDs, revision IDs, database keys, capability names, and audit action codes
- URL destinations, route paths, email addresses, and machine-readable phone values
- Scheduling instants and internal status codes
- Media asset IDs, file digests, and storage paths

Visible labels, human-readable dates, accessible descriptions, and explanatory copy associated with those values remain translatable. A date may be language-neutral only when the source is a fixed official date string that the public design intentionally reproduces verbatim; formatted dates generated for visitors must use locale-aware formatting and cannot be exempted.

## 4. Localization contract

### 4.1 Shared value model

Every translatable field is represented by one stable field identity and a versioned localized value:

```ts
type TranslationOrigin = "manual" | "generated" | "migrated";

type MissingSpanish = {
  mode: "missing";
  sourceDigest: string;
};

type SpanishDraft = {
  mode: "translated";
  status: "draft" | "needs_review";
  value: string;
  origin: TranslationOrigin;
  sourceDigest: string;
  updatedBy: string;
  updatedAt: string;
};

type ApprovedSpanish = {
  mode: "translated";
  status: "approved";
  value: string;
  origin: TranslationOrigin;
  sourceDigest: string;
  translationDigest: string;
  updatedBy: string;
  updatedAt: string;
  approvedBy: string;
  approvedAt: string;
};

type NeutralExemptionRequest = {
  mode: "language_neutral";
  status: "needs_review";
  reasonCode:
    | "proper_name"
    | "official_title"
    | "address"
    | "phone"
    | "date"
    | "identifier";
  explanation: string;
  requestedBy: string;
  requestedAt: string;
  sourceDigest: string;
};

type ApprovedNeutralExemption = Omit<NeutralExemptionRequest,
  "status" | "requestedBy" | "requestedAt"> & {
  status: "approved";
  approvedBy: string;
  approvedAt: string;
  exemptionDigest: string;
};

type LocalizedTextV1 = {
  schemaVersion: 1;
  fieldId: string;
  en: string;
  es:
    | MissingSpanish
    | SpanishDraft
    | ApprovedSpanish
    | NeutralExemptionRequest
    | ApprovedNeutralExemption;
};
```

`fieldId` is stable across drafts and revisions. It identifies a semantic field such as `home.hero.title`, `post:{postId}:body`, `alert:{alertId}:message`, or `form:{formId}:field:{fieldId}:label`.

The source digest is computed from the field identity, canonical English value, and localization schema version. The translation digest is computed from the field identity, source digest, canonical Spanish value, origin, and schema version. The exemption digest is computed from the field identity, source digest, reason code, required explanation, and schema version. Plain text canonicalization normalizes line endings but preserves meaningful whitespace. Rich text canonicalization uses the validated, sanitized document AST with deterministically ordered object keys; HTML serialization is not the digest input. Approval is valid only when the stored source and translation/exemption digests match the current canonical values.

### 4.2 Approval invalidation

Any English edit creates a new content draft and recalculates the digest for each changed field.

- A translated field whose source or translation digest no longer matches loses approval and becomes `needs_review`.
- A language-neutral exemption whose digest no longer matches becomes invalid and must be approved again.
- Editing, replacing, or deleting Spanish removes any prior approval evidence. A manually changed non-empty value becomes `draft`; a generated replacement becomes `needs_review`; deleted Spanish becomes `missing`.
- Switching between translated and language-neutral modes removes prior approval evidence and creates the matching draft or exemption-request state.
- Unchanged fields retain their valid approvals.
- Reverting English to earlier wording does not silently restore an old approval. The restored wording enters a new draft and requires explicit review so history remains truthful.
- Generated Spanish text always enters `needs_review`, even when it matches a previously approved translation.

State transitions are normative:

| Operation | Starting state | Result |
|---|---|---|
| Create English field | none | Spanish `missing` |
| Save Spanish draft | missing/draft/needs review/approved | translated `draft`; old approval removed |
| Submit Spanish for review | current translated `draft` | translated `needs_review` with current source digest |
| Generate Spanish | missing/draft/needs review/approved | translated `needs_review`, origin generated; old approval removed |
| Delete Spanish | any translated state | Spanish `missing`; old approval removed |
| Request neutral treatment | any state | neutral `needs_review`; old approval removed |
| Approve Spanish | current translated `needs_review` with matching source digest | translated `approved` with source digest, translation digest, actor/time |
| Approve neutral request | current neutral `needs_review` with allowed reason, explanation, and matching digest | neutral `approved` with actor/time |
| Edit English | any Spanish state | new source digest is stored; retained non-empty Spanish or exemption is rebound to that digest as `needs_review`, or remains `missing` |
| Publish containing revision | all applicable fields approved and current | immutable bilingual revision plus publication manifest |
| Restore earlier revision | any | new draft; every restored Spanish value/exemption in that restored item becomes `needs_review`; unrelated domain revisions are unchanged |

### 4.3 Resolution rules

The public localization resolver has one interface:

```ts
resolveLocalizedText(value: LocalizedTextV1, locale: "en" | "es"): string
```

- English returns `value.en`.
- Spanish returns an approved Spanish value whose digest matches the English source.
- An approved language-neutral exemption returns the English source in either locale.
- Missing, draft, stale, or unapproved Spanish causes publication validation to fail. The public resolver must never silently fall back to English for a Spanish visitor.

## 5. Storage and revision architecture

### 5.1 Domain-owned immutable revisions

Localized values are stored in the immutable revision that owns the content rather than in a disconnected global translation table. This keeps English, Spanish, ordering, links, schedules, and approval evidence atomic.

The shared contract is embedded in:

- Page and global-region revision snapshots
- Post revision snapshots
- Alert collection revision snapshots
- Managed-form revision snapshots
- Media metadata revisions
- Shared public-message and email-template revisions where those values are not checked into the application catalog

Staging a domain publication validates the complete bilingual snapshot and creates an immutable staged domain manifest. It does not advance a live or independently published domain pointer. A failed validation creates no staged manifest and leaves the live site composition unchanged.

Every public publication also creates an immutable publication manifest. The manifest pins the exact revisions or digests used by that release:

```ts
type DomainPublicationManifestV1 = {
  schemaVersion: 1;
  siteId: string;
  publicationId: string;
  domain: "site" | "post" | "alerts" | "form" | "media" | "email";
  primaryRevisionId: string;
  dependencyRevisions: ReadonlyArray<{
    kind: "media" | "form" | "email_template" | "shared_content";
    stableId: string;
    revisionId: string;
    digest: string;
  }>;
  createdAt: string;
};

type RequestedCompositionDeltaV1 =
  | {
      kind: "domain";
      domain: DomainPublicationManifestV1["domain"];
      stableId: string;
      fromPublicationId: string | null;
      approvedCandidateRevisionId: string;
      dependencyRevisionIds: readonly string[];
    }
  | {
      kind: "global_region";
      fromRevisionId: string;
      approvedCandidateRevisionId: string;
    }
  | {
      kind: "catalog";
      fromRevision: string;
      approvedCandidateRevision: string;
      approvedPublicDigest: string;
    };

type MaterializedCompositionDeltaV1 =
  | {
      kind: "domain";
      domain: DomainPublicationManifestV1["domain"];
      stableId: string;
      fromPublicationId: string | null;
      toPublicationId: string;
    }
  | {
      kind: "global_region";
      fromRevisionId: string;
      toRevisionId: string;
    }
  | {
      kind: "catalog";
      fromRevision: string;
      toRevision: string;
      toPublicDigest: string;
    };

type CandidateSiteCompositionV1 = {
  schemaVersion: 1;
  siteId: string;
  compositionId: string;
  compositionDigest: string;
  baseCompositionId: string;
  intendedDelta: MaterializedCompositionDeltaV1;
  globalRegionRevisionId: string;
  catalogRevision: string;
  catalogPublicDigest: string;
  domainPublications: ReadonlyArray<{
    domain: DomainPublicationManifestV1["domain"];
    stableId: string;
    publicationId: string;
    digest: string;
  }>;
  createdAt: string;
};

type SiteCompositionPublicationV1 = {
  schemaVersion: 1;
  siteId: string;
  compositionId: string;
  compositionDigest: string;
  publicationSequence: number;
  publishedBy: string;
  publishedAt: string;
};
```

`Stage domain change` requires the containing domain's publication capability. It receives the current live composition ID, one `RequestedCompositionDeltaV1`, expected lock version, and an idempotency key. For a domain request, the server validates the candidate and dependencies, allocates the immutable staged `publicationId`, and returns a `MaterializedCompositionDeltaV1` containing that new ID; callers never predict it. It then creates one immutable `CandidateSiteCompositionV1` by copying every entry from the current live composition and applying only the materialized delta. IDs use server-generated UUIDs stored in the committed idempotency result, so same-key replays return the same ID. The composition digest is the SHA-256 of the canonical candidate payload excluding `compositionDigest`; the candidate is immutable after creation. Unrelated staged manifests are never selected implicitly. A global-region or catalog request similarly materializes only its one approved site-wide dependency while pinning all domain entries.

`Publish candidate composition` requires the publication capability for the changed domain item, the exact candidate composition ID/digest, expected current live composition ID, and a fresh idempotency key. One transaction revalidates the immutable candidate's global-region, catalog, and complete manifest set, verifies its canonical digest and authorized intended delta, allocates the next site-scoped monotonic `publicationSequence`, creates `SiteCompositionPublicationV1`, and advances the site's single `published_composition_id` to that already-previewed candidate. It does not regenerate or copy the candidate payload. The live composition ID and digest therefore equal the previewed candidate ID and digest byte-for-byte. A stale live pointer returns `409 STALE_COMPOSITION`; a candidate containing any additional delta returns `403 UNAUTHORIZED_COMPOSITION_DELTA`. Public loaders resolve every route and projection only through the candidate referenced by the live publication receipt. Global navigation/catalog publication therefore changes every public route together; routes cannot intentionally remain on older chrome. Restoration creates a new draft and, after renewed approvals, a staged domain manifest and candidate composition. This makes public output and rollback reproducible.

Both stage and publish commands use a site-scoped idempotency ledger uniquely keyed by `(siteId, idempotencyKey)`, retain entries for at least 90 days, and store the operation, canonical request hash, allocated IDs, and complete safe result. Idempotency lookup occurs before lock or expected-live validation. Repeating the same operation, key, and request hash returns the original staged manifest/candidate or publication receipt even when the live pointer has since advanced; it performs no new mutation. Reusing a key with a different operation or request hash returns `409 IDEMPOTENCY_MISMATCH`. A key cannot be reused across sites. Failed validation that performs no mutation is not stored as a successful replay result.

### 5.2 Checked-in interface catalog

Application-owned interface text uses a typed checked-in catalog:

```ts
type PrivatePublicMessageCatalogSource = {
  schemaVersion: 1;
  revision: string;
  entries: Record<PublicMessageKey, {
    en: string;
    es: string;
    sourceDigest: string;
    translationDigest: string;
    approvedBy: string;
    approvedAt: string;
  }>;
};

type PublicMessageCatalog = {
  schemaVersion: 1;
  revision: string;
  entries: Record<PublicMessageKey, { en: string; es: string }>;
};
```

The key set covers navigation, footer, form errors, status messages, button labels, accessibility announcements, 404 copy, and other application states. The private source and signed server-only approval manifest hold reviewer evidence; the build emits a stripped public catalog containing only keys and approved language values. Tests require exact key parity between English and Spanish. The build fails for a missing value, an empty value, duplicate key, stale or missing source/translation digest, missing approval evidence, malformed interpolation placeholder, or mojibake. The site composition pins the stripped catalog revision and canonical public digest, so a catalog change requires review and a new application and composition release. Reviewer identity never enters client bundles or public projections.

Catalog text is for application-owned UI only. Editor-managed content remains in domain revisions so staff edits and history are preserved.

### 5.3 Additive database changes

Database work is additive and site-scoped. Migrations add versioned localization fields, validation functions, approval metadata, capability checks, indexes, audit categories, and RLS without rewriting or deleting currently published English content.

Required database invariants:

- Anonymous clients cannot read draft translations or approval metadata.
- Authenticated members cannot read or mutate another site's localized drafts.
- Only trusted server publication functions can create staged domain manifests or advance the single live site-composition pointer.
- Approval records identify the actor, time, source digest, origin, and affected field.
- A Spanish approval cannot be inserted for a stale source digest.
- Published snapshots cannot contain `missing`, `draft`, `needs_review`, or stale localized values.
- A language-neutral exemption requires an allowed reason and an authorized approver.
- Public projections omit reviewer IDs, audit metadata, draft text, provider details, and invalidated translations.

## 6. Editor experience

### 6.1 Authoring layout

Every translatable field uses a paired authoring control:

- English source field
- Spanish field or approved language-neutral exemption
- Status badge: `Translation required`, `Draft`, `Needs review`, `Approved`, or `Language neutral`
- Source-change notice when English invalidated an earlier approval
- Reviewer and review timestamp when approved

Long-form content uses separate English and Spanish rich-text editors with the same allowed document schema. The editor does not copy raw HTML between languages; links, lists, headings, and accessible structure are validated in each document.

### 6.2 Optional generated drafts

When a separately approved translation provider is configured, authorized staff may select `Generate Spanish draft`.

- The request contains only the selected public content field and the minimum structural context required to preserve formatting.
- Provider output is stored as `origin: "generated"` and `status: "needs_review"`.
- Generation never records `approvedBy`, never advances a published pointer, and never bypasses normal validation.
- Provider failure leaves the current manual draft unchanged and returns a truthful, non-sensitive error.
- When no provider is configured, the action is visibly unavailable and manual entry remains available.
- Provider activation, credentials, cost controls, retention policy, and vendor selection require a separate reviewed authorization. This specification does not activate AI or outbound translation work.

### 6.3 Approval and permissions

Existing site membership remains authoritative. Capabilities are additive:

- `translations.read`: inspect English, Spanish, status, and public-safe history
- `translations.editDraft`: edit Spanish drafts and create neutral-exemption requests
- `translations.generateDraft`: request a provider draft when configured
- `translations.approve`: approve Spanish or a neutral exemption

Authorization is conjunctive. A member must hold the domain read/edit capability and `translations.read`/`translations.editDraft` to inspect or change a localized draft. Generation additionally requires `translations.generateDraft`. Approval additionally requires the domain edit capability and `translations.approve`. Publication requires only the containing domain's existing publication capability, but the server publication validator must find every translation approved; translation capabilities never grant publication. API handlers and RLS use this same matrix.

Contributors may edit drafts. Editors and owners may approve translations and exemptions. This design does not require a second person to approve the original writer's translation, but every approval records the acting member.

### 6.4 Publish readiness

The editor displays a readiness report grouped by content surface and field. It lists:

- Missing Spanish values
- Draft or generated values awaiting review
- Approvals invalidated by English edits
- Invalid neutral exemptions
- Broken interpolation placeholders or document structure
- Missing localized image alt text, captions, labels, form messages, or metadata

`Publish` is disabled when the local readiness report is incomplete. The server reruns the authoritative validator during the publication transaction so a stale browser or direct API call cannot bypass the gate.

### 6.5 Preview

The editor preview has an English/Spanish selector independent from the visitor preference cookie. It renders the exact candidate revision in the selected locale and identifies unpublished translation states. The public navbar toggle is not used as the draft approval control.

The preview request is an authenticated, site-scoped server request containing `siteId`, changed `domain` and stable item ID, `candidateRevisionId`, `expectedLockVersion`, exact `candidateCompositionId`, exact `candidateCompositionDigest`, expected current live composition ID, and `locale: "en" | "es"`. The server verifies active membership, domain read permission, `translations.read`, candidate ownership, current draft identity, composition digest, and that the candidate composition contains only the intended delta before producing a draft-safe projection of the complete candidate site composition. Responses are `private, no-store`, excluded from CDN and application caches, and carry no public recovery fallback. The preview iframe receives only a short-lived opaque preview session; it cannot select arbitrary revision or composition IDs or read database tables directly. The response visibly identifies the candidate revision, complete composition digest, and locale so staff approves exactly what can be published.

Preview may show a clearly marked English fallback for a missing Spanish draft so staff can locate the field. Production public rendering may not use that fallback.

## 7. Domain-specific publication rules

### 7.1 Pages and shared regions

Every registered public text region and link label is localized under its stable region ID. Section ordering, visibility, URL destinations, and component identity remain shared. Image alt text and captions have their own stable localized fields.

Protected official facts continue to follow their source-governance rules. Proper names and exact office data may use reviewed neutral exemptions; descriptive framing and explanatory text require Spanish translations.

### 7.2 Posts

A post cannot publish until these applicable fields are approved:

- Title
- Excerpt or summary
- Rich-text body
- Visible category or tag labels when they are free-form copy
- Link labels
- Image alt text and captions
- SEO title and description

The slug, author ID, schedule, source URL, and media IDs remain shared. A published post is visible in Spanish only from the same bilingual published revision; separate per-language publication dates are not allowed in this release.

Rich-text English and Spanish documents use independently translatable text nodes but a shared stable-node graph for non-language structure. Headings, paragraph/list positions, media references, embeds, and link destination IDs keep stable node IDs. Visible link text and accessible descriptions are localized; destination URLs are referenced once from the shared structure. The validator rejects missing shared nodes, unauthorized extra embeds, changed destinations outside the shared structure, broken heading/list structure, unsafe protocols, or unsanitized nodes. Staff may intentionally reorder translated prose only through an explicit structure-change command that updates both documents and returns all affected translations to `needs_review`.

### 7.3 Alerts

Each alert message and visible or accessible link label is bilingual within the same immutable alert-collection revision. Category codes, link targets, enabled state, scroll setting, ordering, and schedule are shared.

An alert collection cannot publish if any active or scheduled alert in that revision lacks approved Spanish. Archived alerts do not block a new publication unless they are being restored to an active lifecycle state.

### 7.4 Managed forms

Managed-form revisions localize:

- Headings, descriptions, labels, placeholders, help text, options, and consent wording
- Required/optional indicators and accessibility instructions
- Turnstile and verification guidance
- Client and server validation messages
- Pending, confirmation, success, duplicate, rate-limit, unavailable, and error states

The system locale is always `en | es`. `en-US` and `es-US` are output-format identifiers derived by a shared mapping and are never accepted as authority from the client. A public form projection contains a signed, short-lived projection token binding `siteId`, form revision, site-composition manifest, selected system locale, catalog digest, consent digest, email-template revision when applicable, issue time, expiry, and a random token ID. The browser submits that token with the existing payload and idempotency data. The server verifies the token, current published composition, request origin, and expiry; it does not trust a separately supplied locale. It stores the accepted system locale and derived formatting locale, then returns stable result or error codes. Public clients map codes through the catalog pinned by the token; arbitrary provider error text is never shown.

Projection tokens are reusable until expiry only with the same site, token ID, request hash, and idempotency key. The first accepted submission durably binds those values. An identical replay returns the stored safe result without repeating Turnstile, email, database, or provider side effects. Reusing the token or idempotency key with a different request hash returns `409 IDEMPOTENCY_MISMATCH`; an expired token returns `409 PROJECTION_EXPIRED`; a stale composition returns `409 PROJECTION_STALE`; an invalid signature, site, origin, or locale binding returns `400 INVALID_PROJECTION`. Tokens are not reusable across different forms or visitors' request payloads.

Consent evidence records the exact site-composition manifest, form revision, system locale, consent digest, and catalog digest accepted by the visitor. Changing either consent language creates a new managed-form revision and requires the normal approval workflow.

### 7.5 Newsletter confirmations and email

Newsletter requests retain the verified locale and exact email-template revision bound to the submitted projection. Confirmation pages and first-party confirmation emails render from that approved localized template revision. Email subject, preview text, body, buttons, fallback URLs, consent reminder, and unsubscribe/help wording are localized together.

Provider delivery status, double opt-in, suppression, idempotency, and rate-limit behavior do not change. Because languages cannot publish independently, a missing approved Spanish email template blocks publication of the entire containing newsletter form revision and manifest. The previously published fully bilingual form remains live; the system never sends an unexpected English confirmation to a Spanish request.

### 7.6 Public alerts and client-refreshed content

Public APIs that refresh ordinary visible content read the validated locale cookie. A request parameter may identify locale only when it is cryptographically bound in a server-issued public projection token, as with form submission; otherwise the cookie wins and a conflicting parameter is rejected. Projections contain only the selected approved public language, not draft translations or reviewer evidence. The same rule applies to alert refreshes, published-post refreshes, form states, and other client-updated surfaces.

## 8. Public language behavior

### 8.1 Locale source

The first-party cookie `assembly-language` is the authoritative visitor preference:

- Allowed values: `en` and `es`
- Default: `en`
- Path: `/`
- `SameSite=Lax`
- Secure in production
- Maximum age: 365 days, renewed when the visitor deliberately changes language
- No personal data or user identifier

The root server layout validates the cookie and passes the locale through typed server loaders and public components. It sets `html[lang]` to `en` or `es` before first paint.

The navbar control sets the cookie, updates its own accessible name, and refreshes the current route through the Next.js router. The current pathname, query string, and fragment are preserved. The control does not use a `MutationObserver` to rewrite rendered text.

### 8.2 Same-route rendering

English and Spanish use the same public URL in this release. Navigation keeps the language cookie, so every destination renders in the chosen language. Direct requests without the cookie use English.

Server-generated metadata uses the validated request locale. The same request must never combine Spanish page copy with English metadata, form errors, alert text, or accessibility labels.

All same-URL localized HTML is request-dynamic and must not enter a shared full-page, route, or CDN cache. Locale-independent immutable data may use shared caches, but localization happens after that cache boundary. Locale-specific public API responses use `Cache-Control: private, no-store`; they do not rely on `Vary: Cookie` as a shared-cache safety mechanism. Static assets remain publicly cacheable. Publication invalidates content-revision caches by manifest digest, while visitor locale never becomes part of a shared cache entry. Tests send alternating English and Spanish requests through the production-like cache boundary to prove that one visitor's language cannot leak to another.

Because this design does not add `/es` routes or language-specific canonical URLs, independently indexable Spanish SEO routes are a non-goal. That can be added later without weakening the bilingual publication model.

### 8.3 No untranslated flash

The selected language is resolved on the server. Initial HTML, React payloads, metadata, and public projections already contain the selected approved language. Client hydration does not replace English text with Spanish after the page becomes visible.

If the cookie is invalid, the request deterministically uses English and may clear the invalid cookie on the next response. If locale resolution fails internally, the request renders a minimal checked-in bilingual-safe error boundary in the already selected locale and performs no mixed projection. If a content read fails, the loader may use only a complete immutable site-composition artifact selected through the recovery boundary below, after verifying composition identity, every domain/dependency digest, catalog digest, and bilingual readiness. Per-domain recovery is forbidden. If no complete composition verifies, the localized error boundary is used.

The recovery pointer is an immutable-site-composition recovery boundary:

```ts
type SiteCompositionRecoveryPointerV1 = {
  schemaVersion: 1;
  siteId: string;
  environment: string;
  compositionId: string;
  compositionDigest: string;
  publicationSequence: number;
  artifactPath: string;
  publishedAt: string;
  advancedAt: string;
};
```

The site-composition publication transaction inserts a durable recovery-outbox job containing the exact composition ID, digest, and persisted publication sequence from `SiteCompositionPublicationV1`. A fenced server worker reads that immutable composition and every pinned domain artifact, verifies all digests and bilingual readiness, writes an immutable recovery artifact containing the same sequence, then compare-and-swaps the pointer only when the candidate publication sequence is greater than the pointer's persisted sequence. Anonymous clients cannot read storage tables or pointer metadata; public loaders use a trusted server repository. Retries are idempotent, older workers cannot overwrite newer pointers, and the prior pointer is retained until the new artifact is fully verified. Retention keeps at least the current and three prior valid compositions for 90 days. Recovery always attempts the current pointer first, then earlier retained pointers in descending persisted publication sequence; the first fully verified artifact is used. If none verify, the localized error boundary renders. A recovery drill corrupts the current artifact and proves deterministic prior-pointer selection without mixed composition; an out-of-order-worker fixture proves a lower sequence cannot replace a higher one.

### 8.4 Language-control accessibility

The language control is a two-option selector whose accessible group label comes from the approved catalog: `Website language` in English and `Idioma del sitio web` in Spanish. English and Español options expose their selected state with `aria-pressed` or an equivalent native selection pattern; the visible option names are written in their own language. Activation preserves focus on the corresponding control after the router refresh and announces `Website language changed to English` or `El idioma del sitio cambió a español` once in a polite status region. It does not announce every rerendered page element. Intentional foreign-language passages use an explicit nested `lang` attribute, while approved neutral names and identifiers inherit the page language unless pronunciation requires a reviewed annotation.

## 9. History, audit, and restoration

History records these event types with site, domain, stable item ID, stable field ID, actor, revision, and timestamp:

- English source created or edited
- Spanish draft created or edited
- Generated draft requested and received
- Spanish approval granted
- Approval invalidated, with reason code: English edit, Spanish edit/deletion, generated replacement, translated-neutral mode change, rich-text structure change, or restoration
- Language-neutral exemption requested, approved, invalidated, or removed
- Bilingual revision published
- Earlier bilingual revision selected for restoration

History filters include `English`, `Spanish`, `Translation approval`, `Language-neutral exemption`, and the existing domain categories such as pages, posts, images, alerts, and forms.

Restoring an earlier revision creates a new draft. The restored English and Spanish values remain visible, but approval must be granted again before publication. This prevents a restoration from silently reusing an old decision outside its current audit context.

## 10. Existing-content migration and activation

### 10.1 Inventory

A read-only inventory enumerates every public translatable field from:

- Checked-in public catalog keys
- Published and current draft page/global-region revisions
- Published and draft posts
- Published and draft alerts
- Published and draft managed forms
- Media alt text and captions
- Public email templates and metadata
- 404, privacy, confirmation, empty, loading, and error states

The report groups values by surface, owning domain, stable ID, English source, current Spanish value, source digest, approval evidence, status, publication dependency, and neutral eligibility. It includes all currently published content and every draft that staff marks active for migration. Abandoned drafts do not block activation; they are archived or explicitly marked `legacy_unmigrated`, become read-only, and cannot publish until converted through the new workflow. The inventory must not modify production data.

### 10.2 Backfill

Existing approved Spanish copy is imported as `origin: "migrated"`, tied to the exact English digest, and reviewed before activation. English-only content enters `missing`. Existing proper names and exact official values are not automatically exempted; staff reviews and approves the exemption reason.

Backfill uses deterministic IDs and idempotent commands. Replays with the same input produce the same result. Any conflict or ambiguous field mapping stops the affected item and reports it for review rather than guessing.

### 10.3 Activation boundary

The cutover uses an explicit migration epoch and checkpoint:

1. Deploy the exact activation-compatible application release to production with dual-read/dual-write behavior and the strict gate disabled. New and edited included content writes the bilingual schema; legacy published reads continue unchanged. Verify this release before recording the epoch.
2. Record a migration epoch, exact application/package versions, database migration set, published manifest pointers, and catalog digest.
3. Backfill and review against that epoch while ordinary draft work may continue through dual-write.
4. Enter a bounded publication freeze for included domains. Draft editing may continue, but no legacy or bilingual published pointer may advance.
5. Run a final locked inventory inside the publication transaction boundary. Any source revision or digest that changed after the checkpoint fails preflight and returns to review.
6. Atomically set the database localization activation flag and bilingual manifest pointers. Application code treats the database flag as authoritative; older deployments remain dual-read compatible and cannot publish after the flag changes.
7. Verify the already deployed activation-compatible release in activated mode against English and Spanish smoke tests, then end the freeze. No second application promotion occurs between the flag change and freeze release.

The strict production gate is activated only when:

- The inventory reports zero missing or stale public Spanish fields
- Every neutral exemption is approved
- Database and package migrations are applied and verified
- The checked-in catalog passes parity and encoding checks
- Existing published revisions have validated bilingual equivalents
- Editor readiness and server publication validation agree
- Desktop and mobile preview review is approved
- The exact release passes automated and browser verification
- The final locked inventory matches the recorded epoch and reports no post-checkpoint drift

Activation atomically enables the strict publish validator and bilingual manifest pointers at the database boundary; the already deployed compatible application begins server-rendered locale resolution from that flag. The rollback unit is the recorded epoch: re-enable the frozen legacy read pointers only before any bilingual publication occurs, or roll forward by repairing the bilingual release after the first bilingual publication. Rollback never discards bilingual drafts or audit history. The current published English revision remains recoverable and no current live content is deleted.

After activation, every publication command for an included domain enforces bilingual readiness. There is no owner bypass, emergency English-only switch, or silent fallback. Urgent alerts must therefore be prepared bilingually or use a reviewed neutral exemption where legitimately applicable.

## 11. Shared platform boundaries

Reusable behavior belongs in the shared `@reuben-williams/*` packages; Morales copy stays site-owned.

- `@reuben-williams/core`: locale codes, localized-value contracts, statuses, source digests, capabilities, audit event types, and publish-readiness result codes
- `@reuben-williams/content`: localized revision schemas, validation, resolver interfaces, post/alert/media/form localization contracts, and public projection types
- `@reuben-williams/editor`: paired-field controls, status badges, readiness report, approval and exemption controls, generated-draft boundary, preview locale selector, and history filters
- `@reuben-williams/next`: cookie validation, server locale context, public resolver helpers, route-handler localization, metadata helpers, and client/server export protection
- `@reuben-williams/forms`: localized form projection and stable result-code contracts
- `@reuben-williams/cli`: inventory, backfill planning, attachment compatibility, catalog parity, and activation preflight
- Supabase assets: additive versioned schema, validation functions, RLS, capabilities, audit, and database tests

Package publication follows the existing exact-version and dependency-closure process. The release must be tested in a clean client before this website upgrades. Site-specific English and Spanish catalogs, official facts, and approved translations do not enter reusable package tarballs.

### 11.1 Surface traceability

| Public surface | Owning revision | Publication validator | Public projection | Required authorization | Cache policy |
|---|---|---|---|---|---|
| Navigation, footer, page regions, metadata, 404/privacy/status copy | Site/global-region revision plus pinned catalog | Site bilingual readiness plus manifest dependency check | Server page/metadata locale resolver | Domain capability plus translation capability matrix | Dynamic HTML; locale-independent immutable inputs only |
| Posts and post media text | Post revision plus pinned media revision, composed by one site composition with global-region/catalog revisions | Post bilingual and rich-text structure validator plus site-composition check | Selected-locale published post projection | Post domain plus translation capabilities | Private/no-store when locale-specific |
| Alerts | Alert collection revision composed by one site composition with global-region/catalog revisions | Active/scheduled alert bilingual validator plus site-composition check | Selected-locale public alert projection | Alert domain plus translation capabilities | Private/no-store |
| Managed forms and consent | Managed-form revision plus pinned email template, composed by one site composition with global-region/catalog revisions | Form, consent, template, and site-composition validator | Signed selected-locale form projection | Form domain plus translation capabilities | Private/no-store; signed short-lived projection |
| Newsletter confirmation page/email | Email-template revision pinned by accepted form projection and originating site composition | Email-template, interpolation, and composition validator | Stored verified locale plus exact template revision | Newsletter operations server boundary | No shared visitor cache; provider payload generated per accepted request |
| Editor preview | Candidate revision and draft manifest | Draft-safe structural validator with fallback annotations | Authenticated candidate projection | Domain read plus `translations.read` | Private/no-store; never public recovery |

Normative end-to-end fixtures cover: a linked rich-text post with localized alt text and metadata; a consent-bearing newsletter form bound to a Spanish confirmation email; a scheduled scrolling alert; an approved proper-name exemption; and restoration of one domain while unrelated manifest dependencies remain unchanged.

## 12. Failure handling

- Missing or unapproved Spanish blocks publication and leaves the previous live revision unchanged.
- A stale source digest blocks approval and publication.
- A translation-provider error preserves the current draft and cannot be reported as approval.
- An unavailable provider disables generation but never blocks manual Spanish entry.
- A direct API call cannot bypass server-side readiness validation or capability checks.
- Invalid locale cookies fall back to English and are replaced only by a valid user selection.
- A public API cannot expose drafts, reviewer data, provider prompts, or raw provider failures.
- A missing public translation after activation is treated as data corruption and fails closed; it does not silently render English inside Spanish output.
- A failed locale refresh keeps the current fully rendered language visible and exposes a truthful retryable state rather than mixing languages.
- Migration conflicts stop and produce a review report. They never overwrite editor content heuristically.
- Encoding checks reject mojibake and malformed Unicode before publication.
- Privacy-safe structured observability records only site/domain IDs, revision/digest prefixes, locale, stable failure codes, and timing for projection failures, stale approvals, cache-policy violations, and activation drift. It never records public form values, translated bodies, provider prompts, consent text, or visitor identifiers.

## 13. Verification

### 13.1 Contract and unit coverage

- Locale-cookie validation and default behavior
- Source-digest stability and invalidation after English edits
- Spanish edit/deletion, translated-neutral mode changes, rich-text normalization, and restoration approval invalidation
- Manual, migrated, and generated translation status transitions
- Generated drafts never gaining approval automatically
- Approved neutral exemptions and invalidation after source changes
- Public resolver refusal for missing, draft, stale, or unapproved Spanish
- Checked-in catalog key parity, interpolation parity, non-empty values, and UTF-8/mojibake checks
- English to Spanish to English restoration without DOM mutation
- Stable field IDs across draft revisions
- Localized rich-text structure, links, and accessibility validation
- Metadata, alt text, captions, status announcements, and error-code localization
- Publication-manifest dependency pinning and deterministic restoration
- Candidate-composition canonical digest, exact preview-to-live identity, and typed single-delta validation
- Stage/publish idempotent committed retries, mismatched-key rejection, site scoping, and retention
- Checked-in catalog review evidence and digest pinning

### 13.2 Database and authorization coverage

- Additive migration lineage and checksums
- Immutable domain revisions and atomic published-pointer advancement
- Server-side bilingual readiness enforcement
- Stale digest, missing translation, and invalid exemption rejection
- Anonymous draft denial and cross-site RLS denial
- Contributor edit, editor/owner approval, and domain publication capability boundaries
- Audit evidence for edits, generation, approval, invalidation, exemption, publication, and restoration
- Public projections omitting private translation evidence
- Deterministic, idempotent inventory and backfill behavior
- Migration epoch, publication freeze, final locked inventory, drift rejection, activation flag, and rollback boundary
- Persisted publication-sequence allocation and out-of-order recovery-worker fencing

### 13.3 Domain integration coverage

- Pages and shared chrome
- Posts, including body, media text, and metadata
- Alerts, including scheduled and scrolling alerts
- Contact and newsletter forms, stable error codes, Turnstile states, and consent digests
- Newsletter confirmation page and localized confirmation email
- Projection-token tampering, expiry, locale mismatch, stale manifest, form/template binding, and replay behavior
- Media alt text and captions
- Privacy, 404, empty, unavailable, confirmation, and error states
- Editor readiness report matching server publication validation
- English edits reopening only the affected Spanish approvals

### 13.4 Browser coverage

Test every public route in English and Spanish on desktop and true 390 px mobile:

- Initial server-rendered language and `html[lang]`
- Language toggle on the current route
- Selection persistence across navigation, refresh, direct internal links, and form states
- Selected-state semantics, focus restoration, single change announcement, and nested `lang` annotations
- No English-to-Spanish flash or mixed-language hydration
- Navbar, footer, pages, posts, alerts, forms, validation, confirmations, images, and 404 copy
- Long Spanish text wrapping, button sizing, card height, navigation layout, and horizontal overflow
- Keyboard-only operation and screen-reader labels
- Reduced-motion alert behavior in both languages
- Metadata and public API locale consistency
- Alternating visitor cookies through production-like cache/CDN boundaries without cross-locale leakage
- No console errors, failed first-party requests, broken images, or mojibake

Automated untranslated-text detection compares rendered public English source strings against the approved Spanish output, with explicit allowlists only for reviewed neutral fields and structural values.

### 13.5 Full release gates

- Website unit/integration suite
- TypeScript and lint
- Production build and readiness preflight
- Supabase database tests, lint, and advisors
- Shared package tests, pack inspection, clean-client installation, and attachment rehearsal
- Secret and credential scans
- Protected preview deployment
- Owner-reviewed desktop and mobile public QA
- Production deployment followed by live route, API, metadata, console, network, and publication smoke checks

No synthetic production form, contact, lead, customer, newsletter, or provider records are created during verification.

## 14. Rollout

1. Reconcile the website and shared-platform baselines and reserve additive migration identities.
2. Implement shared localization contracts and failing tests.
3. Add the typed public catalog and complete all application-owned English and Spanish values.
4. Add domain-owned bilingual revision support, capabilities, audit, and server publication validators.
5. Add paired editor controls, approval/exemption workflow, readiness reporting, preview locale, and history filters.
6. Add server cookie localization and replace DOM mutation with render-time locale resolution.
7. Localize pages, posts, alerts, media, forms, emails, metadata, errors, and accessibility text.
8. Run the read-only production inventory.
9. Backfill deterministic translation drafts and review every migrated value and neutral exemption.
10. Publish and verify the exact shared package dependency closure.
11. Upgrade this website to exact package versions and apply reviewed migrations in a protected environment.
12. Verify the complete bilingual backlog and activation preflight in that environment.
13. Complete English/Spanish desktop and mobile review of the exact activation-compatible build.
14. Deploy that exact build to production in dual-read/dual-write inactive mode and verify legacy public behavior.
15. Follow Section 10.3: record the epoch, freeze publication, run the final locked inventory, atomically activate the strict gate and bilingual composition pointers, verify the already deployed build in activated mode, and end the freeze.
16. Verify live English and Spanish routes, editor publishing blocks, composition digest, recovery, API projections, metadata, forms without submission, and absence of untranslated flashes.

## 15. Non-goals

- Live browser translation or DOM text replacement
- Automatically publishing or approving machine-generated translations
- Activating an AI or translation provider without a separate reviewed authorization
- Locale-specific `/es` routes or independently indexable Spanish URLs in this release
- Translating the complete private Staff Portal interface
- Requiring two different staff members for translation approval
- Translating third-party websites opened from official external links
- Rewriting proper names, exact addresses, URLs, phone numbers, or legal identifiers when an approved neutral exemption applies
- Creating separate English and Spanish records that can publish independently and drift
- An emergency English-only publication bypass
- Synthetic production submissions or provider side effects during verification

## 16. Acceptance criteria

The project is complete only when:

- The navbar control switches every included public surface between English and Spanish on the same route.
- The selected language persists across navigation and refresh and is present in server-rendered HTML before first paint.
- Every existing public translatable field has approved Spanish or a reviewed neutral exemption.
- Every future included domain publication is blocked when any required Spanish value is missing, stale, draft, or unapproved.
- English edits invalidate only the affected Spanish approvals and the editor makes the reason visible.
- Staff can manually write, review, approve, preview, audit, and restore bilingual content.
- Optional generated translations, when separately configured, remain non-publishable drafts until staff approval.
- Pages, posts, alerts, forms, emails, images, metadata, errors, accessibility text, privacy, confirmation, and 404 states pass bilingual tests.
- No Spanish public response contains a silent English fallback outside reviewed neutral exemptions.
- Existing production content and history remain recoverable through additive migrations and immutable revisions.
- Shared package and website release gates pass, including clean-client attachment, database tests, browser QA, and live verification.
- No unrelated local files, credentials, or provider side effects are committed or published.
