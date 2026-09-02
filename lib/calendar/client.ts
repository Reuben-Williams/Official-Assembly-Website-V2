import type {
  CalendarCommandRequest,
  CalendarCommandResult,
  CalendarManagementCollection
} from "./repository";

type CalendarBrowserCommand = Omit<CalendarCommandRequest, "context">;

function message(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const error = (value as Record<string, unknown>).error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const candidate = (error as Record<string, unknown>).message;
      if (typeof candidate === "string" && candidate.length > 0) return candidate;
    }
  }
  return "The calendar request could not be completed.";
}

export function createHttpCalendarClient(input: {
  baseUrl?: string;
  getCsrfToken: () => string | null;
}) {
  const baseUrl = input.baseUrl ?? "/api/builder/calendar";
  return Object.freeze({
    async list(): Promise<CalendarManagementCollection> {
      const response = await fetch(baseUrl, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" }
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(message(body));
      return body as CalendarManagementCollection;
    },

    async command(command: CalendarBrowserCommand): Promise<CalendarCommandResult> {
      const csrf = input.getCsrfToken();
      if (!csrf) throw new Error("The editor session must be refreshed.");
      const response = await fetch(`${baseUrl}/${command.command}`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-builder-csrf": csrf,
          "x-idempotency-key": command.idempotencyKey
        },
        body: JSON.stringify({
          eventId: command.eventId,
          expectedVersion: command.expectedVersion,
          ...(command.draft ? { draft: command.draft } : {})
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(message(body));
      return body as CalendarCommandResult;
    }
  });
}

export type CalendarClient = ReturnType<typeof createHttpCalendarClient>;
