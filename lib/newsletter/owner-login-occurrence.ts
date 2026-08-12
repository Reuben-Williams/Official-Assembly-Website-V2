import "server-only";

import { createNewsletterAuthLoginCommandId } from "./owner-login-evidence";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../supabase/admin";

const OCCURRENCE_TIMEOUT_MS = 2_000;

async function deadline<T>(operation: PromiseLike<T>, timeoutMs = OCCURRENCE_TIMEOUT_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("owner_login_occurrence_timeout")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function recordNewsletterOwnerLoginOccurrence(input: {
  readonly operatorId: string;
  readonly authLastSignInAt: string;
}) {
  const occurredAt = new Date(input.authLastSignInAt);
  if (!input.operatorId || !Number.isFinite(occurredAt.getTime())) {
    throw new Error("owner_login_occurrence_unavailable");
  }
  const client = getBuilderAdminClient();
  if (!client) throw new Error("owner_login_occurrence_unavailable");
  const siteId = await deadline(resolveBuilderSiteId(client));
  if (!siteId) throw new Error("owner_login_occurrence_unavailable");
  const commandId = createNewsletterAuthLoginCommandId({
    siteId,
    operatorId: input.operatorId,
    occurredAt: occurredAt.toISOString()
  });
  const result = await deadline(client.rpc("builder_record_newsletter_auth_login_occurrence_v1", {
    p_request: {
      version: 1,
      siteId,
      operatorId: input.operatorId,
      commandId,
      authLastSignInAt: occurredAt.toISOString()
    }
  }));
  const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
    ? result.data as Record<string, unknown>
    : null;
  if (result.error || !data || data.version !== 1 || data.status !== "queued") {
    throw new Error("owner_login_occurrence_unavailable");
  }
  return { state: "queued" as const, commandId };
}
