import "server-only";
import { verifyPreviewCsrf } from "@reuben-williams/next/auth";
import { allowedBuilderOrigins, assertRequestOrigin, BuilderAuthorizationError, type ActiveBuilderIdentity } from "../builder/authorization";
import { authenticateBuilderRequest } from "../builder/request-auth";
import { canRunCalendarCommand, CALENDAR_FIELD_LIMITS } from "./contract";
import { CalendarRepositoryError, readBoundedCalendarJson, trustedCalendarIdentity } from "./repository";
import type { CalendarTranslationSource, CalendarTranslationSuggestion } from "./translation-types";

type Provider = { suggest(source: CalendarTranslationSource): Promise<CalendarTranslationSuggestion> };
const fields = ["title", "description", "actionLabel"] as const;
function bounded(value: unknown, limit: number, required: boolean) {
  if (typeof value !== "string" || value.trim().length > limit || (required && !value.trim())) throw new TypeError("Invalid translation text.");
  return value.trim();
}
function sourceText(value: Record<string, unknown>): CalendarTranslationSource {
  return { titleEn: bounded(value.titleEn, CALENDAR_FIELD_LIMITS.title, true), descriptionEn: bounded(value.descriptionEn, CALENDAR_FIELD_LIMITS.description, true), actionLabelEn: bounded(value.actionLabelEn, CALENDAR_FIELD_LIMITS.actionLabel, false) };
}
function suggestionText(value: Record<string, unknown>): CalendarTranslationSuggestion {
  return { titleEs: bounded(value.titleEs, CALENDAR_FIELD_LIMITS.title, true), descriptionEs: bounded(value.descriptionEs, CALENDAR_FIELD_LIMITS.description, true), actionLabelEs: bounded(value.actionLabelEs, CALENDAR_FIELD_LIMITS.actionLabel, false) };
}

export function createGoogleCalendarTranslationProvider(apiKey: string, fetcher: typeof fetch = fetch): Provider {
  return {
    async suggest(source) {
      const text = sourceText(source);
      const activeFields = fields.filter(field => Boolean(text[`${field}En`]));
      const result = await fetcher("https://translation.googleapis.com/language/translate/v2", {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ q: activeFields.map(field => text[`${field}En`]), source: "en", target: "es", format: "text" }),
      });
      if (!result.ok) throw new Error("Translation provider unavailable.");
      const body = await result.json();
      const translations = body?.data?.translations;
      if (!Array.isArray(translations) || translations.length !== activeFields.length) throw new Error("Invalid translation response.");
      const suggestion: Record<string, unknown> = { titleEs: "", descriptionEs: "", actionLabelEs: "" };
      activeFields.forEach((field, index) => { suggestion[`${field}Es`] = translations[index]?.translatedText; });
      return suggestionText(suggestion);
    },
  };
}
export function configuredCalendarTranslationProvider(): Provider | null {
  const key = process.env.GOOGLE_CLOUD_TRANSLATION_API_KEY?.trim();
  return key ? createGoogleCalendarTranslationProvider(key) : null;
}
export function createCalendarTranslationHandlers(input: {
  provider: Provider | null;
  authenticate?: (request: Request) => Promise<ActiveBuilderIdentity | null>;
  allowedOrigins?: readonly string[];
}) {
  const authenticate = input.authenticate ?? authenticateBuilderRequest;
  const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  const failure = (status: number) => response({ error: { message: status === 503 ? "Automatic translation is unavailable. English fallback remains available." : "The translation request could not be verified. Review the fields and try again." } }, status);
  async function authorize(request: Request) {
    const identity = await trustedCalendarIdentity(request, authenticate);
    if (!canRunCalendarCommand(identity.role, "save_draft")) throw new BuilderAuthorizationError("ROLE_DENIED", 403, "Edit access required.");
    return identity;
  }
  return {
    async GET(request: Request) {
      try { await authorize(request); return response({ available: Boolean(input.provider) }); }
      catch (error) { return failure(error instanceof BuilderAuthorizationError ? error.status : 503); }
    },
    async POST(request: Request) {
      try {
        const identity = await authorize(request);
        assertRequestOrigin(request, input.allowedOrigins ?? allowedBuilderOrigins(new URL(request.url).origin));
        try { verifyPreviewCsrf(identity.csrfToken ?? "", request.headers.get("x-builder-csrf")); }
        catch { return failure(403); }
        const body = await readBoundedCalendarJson(request);
        if (body.confirmed !== true || Object.keys(body).some(key => !["titleEn", "descriptionEn", "actionLabelEn", "confirmed"].includes(key))) return failure(400);
        let source: CalendarTranslationSource;
        try { source = sourceText(body); } catch { return failure(400); }
        if (!input.provider) return failure(503);
        const suggestion = suggestionText(await input.provider.suggest(source));
        if (source.actionLabelEn && !suggestion.actionLabelEs) return failure(503);
        return response(suggestion);
      } catch (error) {
        if (error instanceof BuilderAuthorizationError) return failure(error.status);
        if (error instanceof CalendarRepositoryError) return failure(error.message === "BODY_TOO_LARGE" ? 413 : error.status);
        return failure(503);
      }
    },
  };
}
