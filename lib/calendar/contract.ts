import { parseSafePublicUrl } from "../public-links/safe-public-url";

export const CALENDAR_DISPLAY_TIME_ZONE = "America/New_York" as const;

export const CALENDAR_FIELD_LIMITS = Object.freeze({
  title: 160,
  description: 5_000,
  locationName: 200,
  locationAddress: 500,
  actionLabel: 120
});

export const CALENDAR_COMMANDS = Object.freeze([
  "create_draft",
  "save_draft",
  "publish",
  "unpublish",
  "archive",
  "restore_to_draft"
] as const);

export type CalendarCommand = (typeof CALENDAR_COMMANDS)[number];
export type CalendarRole = "owner" | "editor" | "contributor" | "viewer";
export type CalendarLifecycleState = "active" | "archived";

export type CalendarDraftInput = {
  titleEn?: string | null;
  titleEs?: string | null;
  descriptionEn?: string | null;
  descriptionEs?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  actionUrl?: string | null;
  actionLabelEn?: string | null;
  actionLabelEs?: string | null;
  mediaAssetId?: string | null;
  publicApproved?: boolean;
  hostedByOffice?: boolean;
};

export type NormalizedCalendarDraft = {
  titleEn: string;
  titleEs: string;
  descriptionEn: string;
  descriptionEs: string;
  startAt: string | null;
  endAt: string | null;
  displayTimeZone: typeof CALENDAR_DISPLAY_TIME_ZONE;
  locationName: string;
  locationAddress: string;
  actionUrl: string | null;
  actionLabelEn: string;
  actionLabelEs: string;
  mediaAssetId: string | null;
  publicApproved: boolean;
  hostedByOffice: boolean;
};

export type CalendarEventEntity = {
  id: string;
  siteId: string;
  lifecycleState: CalendarLifecycleState;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  createdByMemberId: string;
  updatedByMemberId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  commandVersion: number;
};

export type CalendarEventRevision = NormalizedCalendarDraft & {
  id: string;
  parentRevisionId: string | null;
  eventId: string;
  siteId: string;
  authorMemberId: string;
  createdAt: string;
};

export type PublicCalendarEvent = {
  id: string;
  titleEn: string;
  titleEs: string;
  descriptionEn: string;
  descriptionEs: string;
  startAt: string;
  endAt: string | null;
  effectiveEndAt: string;
  displayTimeZone: typeof CALENDAR_DISPLAY_TIME_ZONE;
  locationName: string;
  locationAddress: string;
  actionUrl: string | null;
  actionLabelEn: string;
  actionLabelEs: string;
  mediaAssetId: string | null;
  /** Short-lived server-resolved URL for an optional managed-media image. */
  mediaUrl?: string;
};

export type CalendarMediaAsset = {
  id: string;
  siteId: string;
  status: "ready" | "processing" | "failed" | "archived";
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeBoundedText(
  value: string | null | undefined,
  field: string,
  maximumLength: number
): string {
  if (value == null) return "";
  if (typeof value !== "string") throw new TypeError(`${field} must be text.`);

  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new TypeError(`${field} exceeds its maximum length of ${maximumLength}.`);
  }
  return normalized;
}

function normalizeOptionalTimestamp(value: string | null | undefined, field: string): string | null {
  if (value == null || value.trim() === "") return null;

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new TypeError(`${field} is invalid.`);
  return timestamp.toISOString();
}

function normalizeOptionalUuid(value: string | null | undefined, field: string): string | null {
  if (value == null || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  if (!uuidPattern.test(normalized)) throw new TypeError(`${field} must be a valid UUID.`);
  return normalized;
}

export function normalizeCalendarDraft(input: CalendarDraftInput): NormalizedCalendarDraft {
  if (!input || typeof input !== "object") throw new TypeError("A calendar draft is required.");

  const startAt = normalizeOptionalTimestamp(input.startAt, "Event start");
  const endAt = normalizeOptionalTimestamp(input.endAt, "Event end");

  if (startAt && endAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    throw new TypeError("Event end must be later than event start.");
  }

  const rawActionUrl = normalizeBoundedText(input.actionUrl, "Action URL", 2_048);

  return {
    titleEn: normalizeBoundedText(input.titleEn, "English title", CALENDAR_FIELD_LIMITS.title),
    titleEs: normalizeBoundedText(input.titleEs, "Spanish title", CALENDAR_FIELD_LIMITS.title),
    descriptionEn: normalizeBoundedText(
      input.descriptionEn,
      "English description",
      CALENDAR_FIELD_LIMITS.description
    ),
    descriptionEs: normalizeBoundedText(
      input.descriptionEs,
      "Spanish description",
      CALENDAR_FIELD_LIMITS.description
    ),
    startAt,
    endAt,
    displayTimeZone: CALENDAR_DISPLAY_TIME_ZONE,
    locationName: normalizeBoundedText(
      input.locationName,
      "Location name",
      CALENDAR_FIELD_LIMITS.locationName
    ),
    locationAddress: normalizeBoundedText(
      input.locationAddress,
      "Location address",
      CALENDAR_FIELD_LIMITS.locationAddress
    ),
    actionUrl: rawActionUrl ? parseSafePublicUrl(rawActionUrl) : null,
    actionLabelEn: normalizeBoundedText(
      input.actionLabelEn,
      "English action label",
      CALENDAR_FIELD_LIMITS.actionLabel
    ),
    actionLabelEs: normalizeBoundedText(
      input.actionLabelEs,
      "Spanish action label",
      CALENDAR_FIELD_LIMITS.actionLabel
    ),
    mediaAssetId: normalizeOptionalUuid(input.mediaAssetId, "Managed media asset"),
    publicApproved: input.publicApproved === true,
    hostedByOffice: input.hostedByOffice === true
  };
}

export function assertCalendarPublishable(
  draft: NormalizedCalendarDraft,
  context: { siteId: string; mediaAsset?: CalendarMediaAsset }
): NormalizedCalendarDraft {
  const requiredText: Array<[string, string]> = [
    [draft.titleEn, "English title"],
    [draft.titleEs, "Spanish title"],
    [draft.descriptionEn, "English description"],
    [draft.descriptionEs, "Spanish description"],
    [draft.locationName, "Location name"],
    [draft.locationAddress, "Location address"]
  ];

  for (const [value, field] of requiredText) {
    if (!value) throw new TypeError(`${field} is required for publication.`);
  }
  if (!draft.startAt) throw new TypeError("Event start is required for publication.");
  if (!draft.publicApproved) throw new TypeError("Public approval is required for publication.");
  if (!draft.hostedByOffice) throw new TypeError("Office-hosted confirmation is required for publication.");

  if (draft.actionUrl && (!draft.actionLabelEn || !draft.actionLabelEs)) {
    throw new TypeError("English and Spanish action labels are required when an action URL is present.");
  }
  if (!draft.actionUrl && (draft.actionLabelEn || draft.actionLabelEs)) {
    throw new TypeError("An action URL is required when an action label is present.");
  }

  if (draft.mediaAssetId) {
    if (!context.mediaAsset || context.mediaAsset.id !== draft.mediaAssetId) {
      throw new TypeError("The managed media asset is unavailable.");
    }
    if (context.mediaAsset.siteId !== context.siteId) {
      throw new TypeError("The managed media asset does not belong to this site.");
    }
    if (context.mediaAsset.status !== "ready") {
      throw new TypeError("The managed media asset is not ready.");
    }
  }

  return draft;
}

export function canRunCalendarCommand(role: CalendarRole, command: CalendarCommand): boolean {
  if (role === "owner" || role === "editor") return true;
  return role === "contributor" && (command === "create_draft" || command === "save_draft");
}

export function assertCalendarCommandTransition(
  current: CalendarEventEntity,
  command: CalendarCommand
): true {
  if (command === "create_draft") return true;

  if (command === "restore_to_draft") {
    if (current.lifecycleState !== "archived") {
      throw new TypeError("Only an archived event can be restored.");
    }
    return true;
  }

  if (current.lifecycleState !== "active") {
    throw new TypeError("Only an active event can be changed; restore the archived event first.");
  }

  if (command === "publish" && !current.draftRevisionId) {
    throw new TypeError("A current draft is required for publication.");
  }
  if (command === "unpublish" && !current.publishedRevisionId) {
    throw new TypeError("The event is not currently published.");
  }

  return true;
}

type LocalDateParts = { year: number; month: number; day: number };

const localDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CALENDAR_DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const localDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CALENDAR_DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

const editorLocalDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function formatterNumbers(formatter: Intl.DateTimeFormat, value: Date): Record<string, number> {
  return Object.fromEntries(
    formatter.formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
}

function localDate(value: Date): LocalDateParts {
  const parts = formatterNumbers(localDateFormatter, value);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function nextDate(parts: LocalDateParts): LocalDateParts {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function localMidnightToUtc(parts: LocalDateParts): Date {
  const targetAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
  let candidate = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = formatterNumbers(localDateTimeFormatter, new Date(candidate));
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
      0
    );
    const difference = renderedAsUtc - targetAsUtc;
    if (difference === 0) break;
    candidate -= difference;
  }

  return new Date(candidate);
}

export function calendarLocalDateTimeToIso(value: string): string {
  const match = editorLocalDateTimePattern.exec(value);
  if (!match) throw new TypeError("The event date and time are invalid.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = formatterNumbers(localDateTimeFormatter, new Date(candidate));
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
      0
    );
    const difference = renderedAsUtc - targetAsUtc;
    if (difference === 0) break;
    candidate -= difference;
  }

  const rendered = formatterNumbers(localDateTimeFormatter, new Date(candidate));
  if (rendered.year !== year || rendered.month !== month || rendered.day !== day ||
      rendered.hour !== hour || rendered.minute !== minute) {
    throw new TypeError("The selected local time does not exist in America/New_York.");
  }
  return new Date(candidate).toISOString();
}

export function calendarIsoToLocalInput(value: string | null): string {
  if (!value) return "";
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new TypeError("The event timestamp is invalid.");
  const parts = formatterNumbers(localDateTimeFormatter, instant);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function getEffectiveCalendarEnd(revision: CalendarEventRevision): string {
  if (revision.endAt) return new Date(revision.endAt).toISOString();
  if (!revision.startAt) throw new TypeError("A start timestamp is required to compute event expiry.");

  return localMidnightToUtc(nextDate(localDate(new Date(revision.startAt)))).toISOString();
}

export function isPublicCalendarEventEligible(
  entity: CalendarEventEntity,
  revision: CalendarEventRevision,
  now: string | Date
): boolean {
  if (entity.lifecycleState !== "active") return false;
  if (!entity.publishedRevisionId || entity.publishedRevisionId !== revision.id) return false;
  if (revision.eventId !== entity.id || revision.siteId !== entity.siteId) return false;
  if (!revision.publicApproved || !revision.hostedByOffice) return false;

  const queryInstant = typeof now === "string" ? new Date(now) : now;
  if (Number.isNaN(queryInstant.getTime())) throw new TypeError("The calendar query instant is invalid.");

  return new Date(getEffectiveCalendarEnd(revision)).getTime() > queryInstant.getTime();
}

export function toPublicCalendarEvent(
  entity: CalendarEventEntity,
  revision: CalendarEventRevision
): PublicCalendarEvent {
  if (revision.eventId !== entity.id || revision.siteId !== entity.siteId) {
    throw new TypeError("The event revision does not belong to the event entity.");
  }
  if (!revision.startAt) throw new TypeError("A public event requires a start timestamp.");

  return {
    id: entity.id,
    titleEn: revision.titleEn,
    titleEs: revision.titleEs,
    descriptionEn: revision.descriptionEn,
    descriptionEs: revision.descriptionEs,
    startAt: revision.startAt,
    endAt: revision.endAt,
    effectiveEndAt: getEffectiveCalendarEnd(revision),
    displayTimeZone: CALENDAR_DISPLAY_TIME_ZONE,
    locationName: revision.locationName,
    locationAddress: revision.locationAddress,
    actionUrl: revision.actionUrl,
    actionLabelEn: revision.actionLabelEn,
    actionLabelEs: revision.actionLabelEs,
    mediaAssetId: revision.mediaAssetId
  };
}

export function sortPublicCalendarEvents(events: readonly PublicCalendarEvent[]): PublicCalendarEvent[] {
  return [...events].sort((left, right) => {
    const startDifference = new Date(left.startAt).getTime() - new Date(right.startAt).getTime();
    return startDifference || left.id.localeCompare(right.id);
  });
}
