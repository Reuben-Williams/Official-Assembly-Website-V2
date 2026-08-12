import {
  approveSpanishTranslationV1,
  createLocalizedDomainRevisionV1,
  createLocalizedTextV1,
  editSpanishDraftV1,
  submitSpanishForReviewV1,
  type LocalizedDomainRevisionV1,
  type LocalizedDomainV1,
  type LocalizedTextV1,
} from "@reuben-williams/content";
import {
  canBuilderRole,
  type BuilderCapability,
  type BuilderRole,
} from "@reuben-williams/core";

export type BilingualEditorOperation =
  | "read"
  | "save_draft"
  | "submit_review"
  | "approve"
  | "stage"
  | "publish"
  | "restore"
  | "activate";

const BILINGUAL_OPERATION_CAPABILITIES: Readonly<Record<BilingualEditorOperation, BuilderCapability>> = {
  read: "translations.read",
  save_draft: "translations.editDraft",
  submit_review: "translations.editDraft",
  approve: "translations.approve",
  stage: "translations.editDraft",
  publish: "post.publish",
  restore: "post.rollback",
  activate: "members.manage",
};

export function bilingualCapabilityForOperation(operation: BilingualEditorOperation): BuilderCapability {
  return BILINGUAL_OPERATION_CAPABILITIES[operation];
}

export function roleCanPerformBilingualOperation(
  role: BuilderRole,
  operation: BilingualEditorOperation,
): boolean {
  return canBuilderRole(role, bilingualCapabilityForOperation(operation));
}

export function domainReadCapability(domain: LocalizedDomainV1): BuilderCapability {
  if (domain === "post") return "preview.read";
  if (domain === "alerts") return "alerts.read";
  if (domain === "form") return "forms.read";
  if (domain === "media") return "media.upload";
  return "preview.read";
}

export function domainEditCapability(domain: LocalizedDomainV1): BuilderCapability {
  if (domain === "post") return "post.editDraft";
  if (domain === "alerts") return "alerts.editDraft";
  if (domain === "form") return "forms.editDraft";
  if (domain === "media") return "media.upload";
  return "post.editDraft";
}

export function domainPublishCapability(domain: LocalizedDomainV1): BuilderCapability {
  if (domain === "alerts") return "alerts.publish";
  if (domain === "form") return "forms.publish";
  return "post.publish";
}

export interface LocalizationInventoryItem {
  readonly domain: LocalizedDomainV1;
  readonly stableId: string;
  readonly fieldId: string;
  readonly english: string;
  readonly spanish: string | null;
  readonly status: "missing" | "needs_review" | "approved";
  readonly sourceDigest: string;
  readonly exemptionEligible: boolean;
  readonly source: string;
}

async function inventoryText(
  item: LocalizationInventoryItem,
  actorId: string,
  createdAt: string,
): Promise<LocalizedTextV1> {
  const value = await createLocalizedTextV1({ fieldId: item.fieldId, en: item.english });
  if (!item.spanish?.trim()) return value;
  const draft = await editSpanishDraftV1(value, {
    value: item.spanish,
    updatedBy: actorId,
    updatedAt: createdAt,
  });
  return submitSpanishForReviewV1(draft);
}

export async function createInitialLocalizedRevision(input: {
  readonly siteId: string;
  readonly actorId: string;
  readonly revisionId: string;
  readonly createdAt: string;
  readonly domain: LocalizedDomainV1;
  readonly stableId: string;
  readonly items: readonly LocalizationInventoryItem[];
}): Promise<LocalizedDomainRevisionV1> {
  if (input.items.length === 0 || input.items.some((item) =>
    item.domain !== input.domain || item.stableId !== input.stableId)) {
    throw new TypeError("Localization inventory group is invalid.");
  }
  return createLocalizedDomainRevisionV1({
    siteId: input.siteId,
    domain: input.domain,
    stableId: input.stableId,
    revisionId: input.revisionId,
    parentRevisionId: null,
    fields: await Promise.all(input.items.map(async (item) => ({
      kind: "text" as const,
      value: await inventoryText(item, input.actorId, input.createdAt),
    }))),
    createdBy: input.actorId,
    createdAt: input.createdAt,
  });
}

export type SpanishRevisionOperation = "save_draft" | "submit_review" | "approve";

export async function reviseSpanishLocalization(
  current: LocalizedDomainRevisionV1,
  input: {
    readonly operation: SpanishRevisionOperation;
    readonly fieldId: string;
    readonly spanish?: string;
    readonly actorId: string;
    readonly revisionId: string;
    readonly createdAt: string;
  },
): Promise<LocalizedDomainRevisionV1> {
  let found = false;
  const fields = await Promise.all(current.fields.map(async (field) => {
    if (field.kind !== "text" || field.value.fieldId !== input.fieldId) return field;
    found = true;
    const value = input.operation === "save_draft"
      ? await editSpanishDraftV1(field.value, {
        value: input.spanish ?? "",
        updatedBy: input.actorId,
        updatedAt: input.createdAt,
      })
      : input.operation === "submit_review"
        ? submitSpanishForReviewV1(field.value)
        : await approveSpanishTranslationV1(field.value, {
          approvedBy: input.actorId,
          approvedAt: input.createdAt,
        });
    return { kind: "text" as const, value };
  }));
  if (!found) throw new TypeError(`Localized text field ${input.fieldId} was not found.`);
  return createLocalizedDomainRevisionV1({
    ...current,
    revisionId: input.revisionId,
    parentRevisionId: current.revisionId,
    fields,
    createdBy: input.actorId,
    createdAt: input.createdAt,
  });
}
