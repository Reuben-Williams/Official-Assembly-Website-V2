import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CalendarRepositoryError,
  type CalendarCommandRequest,
  type CalendarCommandResult,
  type CalendarManagementCollection,
  type CalendarRequestContext,
  type CalendarRepository
} from "./repository";
import type { PublicCalendarEvent } from "./contract";

type RpcClient = Pick<SupabaseClient, "rpc">;

function payload(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function repositoryError(error: unknown): CalendarRepositoryError {
  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(candidate.code ?? "");
  const message = String(candidate.message ?? "");
  if (code === "40001" || /STALE_CALENDAR_VERSION/i.test(message)) {
    return new CalendarRepositoryError("STALE_VERSION", 409, "Calendar version conflict.");
  }
  if (code === "42501" || /CALENDAR_ROLE_DENIED/i.test(message)) {
    return new CalendarRepositoryError("FORBIDDEN", 403, "Calendar action denied.");
  }
  if (code === "P0002" || /CALENDAR_NOT_FOUND/i.test(message)) {
    return new CalendarRepositoryError("NOT_FOUND", 404, "Calendar event missing.");
  }
  if (["22023", "23514", "P0001"].includes(code) || /CALENDAR_VALIDATION/i.test(message)) {
    return new CalendarRepositoryError("VALIDATION", 400, "Calendar validation failed.");
  }
  return new CalendarRepositoryError("UNAVAILABLE", 503, "Calendar database unavailable.");
}

function managementCollection(value: unknown): CalendarManagementCollection {
  const candidate = payload(value);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new CalendarRepositoryError("UNAVAILABLE", 503, "Calendar response unavailable.");
  }
  const record = candidate as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !Array.isArray(record.events) || record.events.length > 1_000) {
    throw new CalendarRepositoryError("UNAVAILABLE", 503, "Calendar response unavailable.");
  }
  return candidate as CalendarManagementCollection;
}

function commandResult(value: unknown): CalendarCommandResult {
  const candidate = payload(value);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new CalendarRepositoryError("UNAVAILABLE", 503, "Calendar response unavailable.");
  }
  const record = candidate as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !record.event || typeof record.event !== "object") {
    throw new CalendarRepositoryError("UNAVAILABLE", 503, "Calendar response unavailable.");
  }
  return candidate as CalendarCommandResult;
}

function publicEvents(value: unknown): PublicCalendarEvent[] {
  const candidate = payload(value);
  const events = Array.isArray(candidate)
    ? candidate
    : candidate && typeof candidate === "object" && Array.isArray((candidate as Record<string, unknown>).events)
      ? (candidate as { events: unknown[] }).events
      : null;
  if (!events || events.length > 1_000) {
    throw new CalendarRepositoryError("UNAVAILABLE", 503, "Calendar response unavailable.");
  }
  return events as PublicCalendarEvent[];
}

export function createSupabaseCalendarRepository(client: RpcClient): CalendarRepository {
  return Object.freeze({
    async listManagement(context: CalendarRequestContext) {
      const result = await client.rpc("builder_calendar_list_v1", {
        p_site_id: context.siteId
      });
      if (result.error) throw repositoryError(result.error);
      return managementCollection(result.data);
    },

    async readPublic(input: { siteKey: string; evaluatedAt: string; limit: number }) {
      const result = await client.rpc("builder_calendar_public_v1", {
        p_site_key: input.siteKey,
        p_evaluated_at: input.evaluatedAt,
        p_limit: input.limit
      });
      if (result.error) throw repositoryError(result.error);
      return publicEvents(result.data);
    },

    async executeCommand(input: CalendarCommandRequest) {
      const result = await client.rpc("builder_calendar_command_v1", {
        p_site_id: input.context.siteId,
        p_actor_id: input.context.userId,
        p_command: input.command,
        p_event_id: input.eventId,
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
        p_draft: input.draft ?? null
      });
      if (result.error) throw repositoryError(result.error);
      return commandResult(result.data);
    }
  });
}
