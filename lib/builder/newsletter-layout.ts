import type { EditableValue } from "@reuben-williams/core";

export const NEWSLETTER_SECTION_ORDER = Object.freeze([
  "form",
  "features",
  "supporting",
] as const);

export function normalizeNewsletterSectionIds(
  _requested: readonly string[],
  includeSecondary = false,
) {
  return includeSecondary
    ? [...NEWSLETTER_SECTION_ORDER, "secondary"]
    : [...NEWSLETTER_SECTION_ORDER];
}

type NewsletterEditableInput = Readonly<{
  pagePath: string;
  regionId: string;
  value: EditableValue;
}>;

type NewsletterSnapshotInput = Readonly<{
  pagePath: string;
  regions: Readonly<Record<string, EditableValue>>;
}>;

type NewsletterContentSnapshot = Readonly<{
  versionId?: string | null;
  regions: Readonly<Record<string, EditableValue>>;
}>;

const RETIRED_NEWSLETTER_REGIONS = new Set([
  "newsletter.hero.eyebrow",
  "newsletter.hero.title",
  "newsletter.hero.body",
  "newsletter.hero.primary-cta",
  "newsletter.hero.secondary-cta",
]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function migratedNewsletterRegions(regions: Readonly<Record<string, EditableValue>>) {
  const values = { ...regions };
  for (const regionId of RETIRED_NEWSLETTER_REGIONS) delete values[regionId];
  values["newsletter.sections"] = {
    type: "sections",
    value: normalizeNewsletterSectionIds(
      regions["newsletter.sections"]?.type === "sections"
        ? regions["newsletter.sections"].value
        : [],
    ),
  };
  return values;
}

export function normalizeNewsletterEditableValue(
  input: NewsletterEditableInput,
): EditableValue {
  if (input.pagePath !== "/newsletter" || input.regionId !== "newsletter.sections") {
    return input.value;
  }
  if (input.value.type !== "sections") {
    throw new TypeError("The newsletter page section order must be a sections value.");
  }
  return {
    type: "sections",
    value: normalizeNewsletterSectionIds(input.value.value),
  };
}

export function validateNewsletterLayoutSnapshot(input: NewsletterSnapshotInput): void {
  if (input.pagePath !== "/newsletter") return;
  const value = input.regions["newsletter.sections"];
  if (value === undefined) return;
  if (value.type !== "sections") {
    throw new TypeError("The newsletter page requires a form-first section order.");
  }
  const expected = normalizeNewsletterSectionIds(value.value);
  if (value.value.length !== expected.length || value.value.some((id, index) => id !== expected[index])) {
    throw new TypeError("The newsletter page requires a form-first section order.");
  }
}

export function planNewsletterLayoutTransition(input: Readonly<{
  draft: NewsletterContentSnapshot;
  published: NewsletterContentSnapshot;
}>) {
  const draftValues = migratedNewsletterRegions(input.draft.regions);
  const publishedValues = migratedNewsletterRegions(input.published.regions);
  const retiredRegionIds = [...new Set([
    ...Object.keys(input.draft.regions),
    ...Object.keys(input.published.regions),
  ].filter((regionId) => RETIRED_NEWSLETTER_REGIONS.has(regionId)))].sort();
  const base = {
    expectedDraftVersionId: input.draft.versionId ?? null,
    expectedPublishedVersionId: input.published.versionId ?? null,
    retiredRegionIds,
    values: draftValues,
  };

  if (canonical(draftValues) !== canonical(publishedValues)) {
    return { status: "blocked_pending_draft" as const, ...base };
  }
  if (
    canonical(input.draft.regions) === canonical(draftValues)
    && canonical(input.published.regions) === canonical(publishedValues)
  ) {
    return { status: "already_current" as const, ...base };
  }
  return { status: "changes_required" as const, ...base };
}
