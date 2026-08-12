import "server-only";

const SAFE_STRING_FIELDS = [
  "event",
  "code",
  "operation",
  "siteId",
  "jobId",
  "subscriptionId",
  "broadcastId",
  "providerMessageId",
  "providerStatus",
  "readinessRevision",
  "digestPrefix",
  "timestamp"
] as const;

const SAFE_NUMBER_FIELDS = ["httpStatus", "attempt", "audienceCount"] as const;
const SAFE_BOOLEAN_FIELDS = ["retryable"] as const;

type SafeLogValue = string | number | boolean;

export function toSafeNewsletterLog(input: unknown): Record<string, SafeLogValue> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const source = input as Record<string, unknown>;
  const safe: Record<string, SafeLogValue> = {};

  for (const field of SAFE_STRING_FIELDS) {
    const value = source[field];
    if (typeof value === "string" && value.length > 0 && value.length <= 256) {
      safe[field] = value;
    }
  }

  for (const field of SAFE_NUMBER_FIELDS) {
    const value = source[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      safe[field] = value;
    }
  }

  for (const field of SAFE_BOOLEAN_FIELDS) {
    const value = source[field];
    if (typeof value === "boolean") {
      safe[field] = value;
    }
  }

  return safe;
}
