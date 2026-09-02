import "server-only";

import { verifyPreviewCsrf } from "@reuben-williams/next/auth";

import {
  CALENDAR_COMMANDS,
  canRunCalendarCommand,
  normalizeCalendarDraft,
  sortPublicCalendarEvents,
  type CalendarCommand,
  type CalendarEventEntity,
  type CalendarEventRevision,
  type CalendarRole,
  type NormalizedCalendarDraft,
  type PublicCalendarEvent
} from "./contract";
import {
  BUILDER_SITE_KEY,
  BuilderAuthorizationError,
  allowedBuilderOrigins,
  assertRequestOrigin,
  type ActiveBuilderIdentity
} from "../builder/authorization";
import { authenticateBuilderRequest } from "../builder/request-auth";

export type CalendarRequestContext = {
  siteId: string;
  siteKey: string;
  userId: string;
  role: CalendarRole;
};

export type CalendarManagementEvent = {
  entity: CalendarEventEntity;
  draftRevision: CalendarEventRevision | null;
  publishedRevision: CalendarEventRevision | null;
};

export type CalendarManagementCollection = {
  schemaVersion: 1;
  events: CalendarManagementEvent[];
};

export type CalendarCommandRequest = {
  context: CalendarRequestContext;
  command: CalendarCommand;
  eventId: string | null;
  expectedVersion: number;
  idempotencyKey: string;
  draft?: NormalizedCalendarDraft;
};

export type CalendarCommandResult = {
  schemaVersion: 1;
  command: CalendarCommand;
  event: CalendarManagementEvent;
};

export interface CalendarRepository {
  listManagement(context: CalendarRequestContext): Promise<CalendarManagementCollection>;
  readPublic(input: {
    siteKey: string;
    evaluatedAt: string;
    limit: number;
  }): Promise<PublicCalendarEvent[]>;
  executeCommand(input: CalendarCommandRequest): Promise<CalendarCommandResult>;
}

export type CalendarRepositoryErrorCode =
  | "CONFLICT"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE_VERSION"
  | "UNAVAILABLE"
  | "VALIDATION";

export class CalendarRepositoryError extends Error {
  constructor(
    readonly code: CalendarRepositoryErrorCode,
    readonly status: 400 | 403 | 404 | 409 | 503,
    message: string
  ) {
    super(message);
    this.name = "CalendarRepositoryError";
  }
}

export type PublicCalendarLoad =
  | { status: "ready"; events: PublicCalendarEvent[] }
  | { status: "unavailable" };

export async function loadPublicCalendar(
  repository: CalendarRepository,
  input: { siteKey: string; evaluatedAt: string; limit: number }
): Promise<PublicCalendarLoad> {
  const evaluatedAt = new Date(input.evaluatedAt);
  if (Number.isNaN(evaluatedAt.getTime())) throw new TypeError("The calendar query instant is invalid.");
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));

  try {
    const events = await repository.readPublic({
      siteKey: input.siteKey,
      evaluatedAt: evaluatedAt.toISOString(),
      limit
    });
    const eligible = events.filter((event) => {
      const end = new Date(event.effectiveEndAt);
      return !Number.isNaN(end.getTime()) && end.getTime() > evaluatedAt.getTime();
    });
    return { status: "ready", events: sortPublicCalendarEvents(eligible).slice(0, limit) };
  } catch {
    return { status: "unavailable" };
  }
}

type AuthenticateCalendarRequest = (request: Request) => Promise<ActiveBuilderIdentity | null>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const maximumBodyBytes = 65_536;

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

function errorResponse(status: number, code: string, message: string) {
  return response({ error: { code, message } }, status);
}

function repositoryErrorResponse(error: CalendarRepositoryError) {
  const messages: Record<CalendarRepositoryErrorCode, string> = {
    CONFLICT: "The calendar command conflicts with the current event state. Refresh and try again.",
    FORBIDDEN: "This account cannot perform that calendar action.",
    NOT_FOUND: "The calendar event could not be found.",
    STALE_VERSION: "The event changed. Refresh and try again.",
    UNAVAILABLE: "The calendar service is temporarily unavailable.",
    VALIDATION: "The calendar information is invalid. Review the fields and try again."
  };
  return errorResponse(error.status, error.code, messages[error.code]);
}

async function trustedIdentity(
  request: Request,
  authenticate: AuthenticateCalendarRequest
): Promise<ActiveBuilderIdentity> {
  const identity = await authenticate(request);
  if (!identity) {
    throw new BuilderAuthorizationError("AUTH_REQUIRED", 401, "A verified editor session is required.");
  }
  if (identity.siteKey !== BUILDER_SITE_KEY) {
    throw new BuilderAuthorizationError("SITE_ACCESS_DENIED", 403, "This account cannot access this site.");
  }
  if (identity.sessionGeneration !== identity.tokenGeneration) {
    throw new BuilderAuthorizationError("AUTH_SESSION_REVOKED", 401, "The editor session is no longer active.");
  }
  return identity;
}

function authorizationResponse(error: BuilderAuthorizationError) {
  const code = error.status === 401 ? "AUTH_REQUIRED" : error.code;
  const message = error.status === 401
    ? "A verified editor session is required."
    : "The calendar request is not authorized.";
  return errorResponse(error.status, code, message);
}

async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new CalendarRepositoryError("VALIDATION", 400, "JSON_REQUIRED");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes) {
    throw new CalendarRepositoryError("VALIDATION", 400, "BODY_TOO_LARGE");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBodyBytes) {
    throw new CalendarRepositoryError("VALIDATION", 400, "BODY_TOO_LARGE");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CalendarRepositoryError("VALIDATION", 400, "INVALID_JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CalendarRepositoryError("VALIDATION", 400, "INVALID_BODY");
  }
  return value as Record<string, unknown>;
}

export function createCalendarRouteHandlers(input: {
  repository: CalendarRepository;
  authenticate?: AuthenticateCalendarRequest;
  allowedOrigins?: readonly string[];
}) {
  const authenticate = input.authenticate ?? authenticateBuilderRequest;

  return Object.freeze({
    async list(request: Request) {
      try {
        const identity = await trustedIdentity(request, authenticate);
        const collection = await input.repository.listManagement({
          siteId: identity.siteId,
          siteKey: identity.siteKey,
          userId: identity.userId,
          role: identity.role
        });
        return response(collection);
      } catch (error) {
        if (error instanceof BuilderAuthorizationError) return authorizationResponse(error);
        if (error instanceof CalendarRepositoryError) return repositoryErrorResponse(error);
        return errorResponse(503, "UNAVAILABLE", "The calendar service is temporarily unavailable.");
      }
    },

    async command(request: Request, rawCommand: string) {
      if (!CALENDAR_COMMANDS.includes(rawCommand as CalendarCommand)) {
        return errorResponse(404, "ROUTE_NOT_FOUND", "The calendar route was not found.");
      }
      const command = rawCommand as CalendarCommand;

      try {
        const identity = await trustedIdentity(request, authenticate);
        assertRequestOrigin(
          request,
          input.allowedOrigins ?? allowedBuilderOrigins(new URL(request.url).origin)
        );
        try {
          verifyPreviewCsrf(identity.csrfToken ?? "", request.headers.get("x-builder-csrf"));
        } catch {
          throw new BuilderAuthorizationError("CSRF_REJECTED", 403, "The request could not be verified.");
        }
        if (!canRunCalendarCommand(identity.role, command)) {
          throw new BuilderAuthorizationError("ROLE_DENIED", 403, "This account cannot perform that action.");
        }

        const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.startsWith("application/json")) {
          return errorResponse(415, "CONTENT_TYPE_REQUIRED", "Calendar commands require JSON.");
        }
        const idempotencyKey = request.headers.get("x-idempotency-key") ?? "";
        if (!idempotencyPattern.test(idempotencyKey)) {
          return errorResponse(400, "IDEMPOTENCY_REQUIRED", "A valid idempotency key is required.");
        }
        const body = await readBoundedJson(request);
        const expectedVersion = body.expectedVersion;
        if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0) {
          return errorResponse(400, "INVALID_VERSION", "A valid event version is required.");
        }

        const rawEventId = body.eventId;
        const eventId = command === "create_draft" ? null : typeof rawEventId === "string" ? rawEventId : "";
        if (command !== "create_draft" && !uuidPattern.test(eventId ?? "")) {
          return errorResponse(400, "INVALID_EVENT_ID", "A valid event ID is required.");
        }

        let draft: NormalizedCalendarDraft | undefined;
        if (command === "create_draft" || command === "save_draft") {
          try {
            draft = normalizeCalendarDraft(body.draft as never);
          } catch {
            return errorResponse(400, "INVALID_DRAFT", "Review the event fields and try again.");
          }
        }

        const result = await input.repository.executeCommand({
          context: {
            siteId: identity.siteId,
            siteKey: identity.siteKey,
            userId: identity.userId,
            role: identity.role
          },
          command,
          eventId,
          expectedVersion: Number(expectedVersion),
          idempotencyKey,
          ...(draft ? { draft } : {})
        });
        return response(result, command === "create_draft" ? 201 : 200);
      } catch (error) {
        if (error instanceof BuilderAuthorizationError) return authorizationResponse(error);
        if (error instanceof CalendarRepositoryError) {
          if (error.message === "BODY_TOO_LARGE") {
            return errorResponse(413, "BODY_TOO_LARGE", "The calendar request is too large.");
          }
          return repositoryErrorResponse(error);
        }
        return errorResponse(503, "UNAVAILABLE", "The calendar service is temporarily unavailable.");
      }
    }
  });
}
