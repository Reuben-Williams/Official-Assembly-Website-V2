import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

type RpcClient = Pick<SupabaseClient, "rpc">;
export type TeamNoticePayload = { from: string; to: string[]; subject: string; text: string; html: string; tags: { name: string; value: string }[] };
type Job = { id: string; fence: number; payload: TeamNoticePayload; idempotencyKey: string; firstAttemptAt: string | null; retryDeadline: string | null };

export async function teamNoticeRpc(client: RpcClient, siteId: string, operation: string, input: Record<string, unknown> = {}) {
  const result = await client.rpc("builder_team_notices_v1", { p_site_id: siteId, p_operation: operation, p_input: input });
  if (result.error) throw new Error("notice evidence unavailable");
  return result.data as unknown;
}

export async function readTeamNoticeMessageIds(client: RpcClient, siteId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const rows = await teamNoticeRpc(client, siteId, "message_ids", { offset });
    if (!Array.isArray(rows) || rows.some(id => typeof id !== "string" || !id || id.length > 200)) throw new Error("notice evidence unavailable");
    for (const id of rows) ids.add(id);
    if (rows.length < 1000) return ids;
  }
  throw new Error("notice evidence unavailable");
}

function parseJob(value: unknown): Job {
  const job = value as Job | null;
  const p = job?.payload;
  if (!job || typeof job.id !== "string" || !Number.isSafeInteger(job.fence) || typeof job.idempotencyKey !== "string"
    || !p || p.from !== "Office of Assemblywoman Carmen Morales <newsletter@updates.assemblywomanmorales.com>"
    || JSON.stringify(p.to) !== '["aswcmoralesteam@gmail.com"]' || p.subject !== "New website submission — Morales Staff Portal"
    || typeof p.text !== "string" || typeof p.html !== "string" || p.text.length > 1000 || p.html.length > 1500
    || !Array.isArray(p.tags) || p.tags.length !== 3
    || !p.tags.some(t => t.name === "purpose" && t.value === "website_team_notice")
    || !p.tags.some(t => t.name === "policy" && t.value === "website-team-notice-v1")
    || !p.tags.some(t => t.name === "notice_correlation" && /^[a-f0-9-]{36}$/.test(t.value))) throw new Error("notice evidence unavailable");
  return job;
}

export async function runTeamNoticeWorker({ client, siteId, send, pace = () => new Promise<void>(resolve => setTimeout(resolve, 1100)), now = () => new Date() }: {
  client: RpcClient; siteId: string;
  send: (payload: TeamNoticePayload, options: { idempotencyKey: string }) => Promise<{ data: { id: string } | null; error: { name?: string } | null }>;
  pace?: () => Promise<void>; now?: () => Date;
}) {
  const workerId = crypto.randomUUID();
  const values = await teamNoticeRpc(client, siteId, "claim", { workerId });
  if (!Array.isArray(values) || values.length > 2) throw new Error("notice evidence unavailable");
  const jobs = values.map(parseJob);
  const counts = { claimed: jobs.length, completed: 0, failed: 0, blocked: 0 };
  for (const job of jobs) {
    const claim = { jobId: job.id, fence: job.fence, workerId };
    if (job.retryDeadline && Date.parse(job.retryDeadline) <= now().getTime()) {
      await teamNoticeRpc(client, siteId, "finish", { ...claim, code: "retryable" }); counts.blocked++; continue;
    }
    const attempt = await teamNoticeRpc(client, siteId, "begin", claim) as { firstAttemptAt?: string; retryDeadline?: string } | null;
    if (!attempt) { counts.blocked++; continue; }
    if (!attempt.firstAttemptAt || !attempt.retryDeadline || !Number.isFinite(Date.parse(attempt.retryDeadline))
      || Date.parse(attempt.retryDeadline) <= now().getTime()) throw new Error("notice evidence unavailable");
    let id: string | null = null; let code = "retryable";
    try {
      const result = await send(job.payload, { idempotencyKey: job.idempotencyKey });
      if (!result.error && result.data?.id && result.data.id.length <= 200) id = result.data.id;
      if (result.error && ["validation_error", "missing_api_key", "invalid_api_key", "restricted_api_key"].includes(result.error.name ?? "")) code = "terminal";
    } catch { /* An unknown outcome may already have been accepted. Same-key retry only. */ }
    const finished = await teamNoticeRpc(client, siteId, "finish", { ...claim, ...(id ? { providerMessageId: id } : { code }) });
    if (finished === "review") counts.blocked++;
    else if (id) counts.completed++;
    else counts.failed++;
    await pace();
  }
  return counts;
}

export async function reconcileVerifiedTeamNotice(client: RpcClient, siteId: string, providerScope: string, event: {
  svixId: string; type: string; createdAt: string; data: Record<string, unknown>;
}) {
  // Must be invoked only after SDK signature verification. Never trust a payload account/scope field.
  if (!event.data.tags || typeof event.data.tags !== "object" || Array.isArray(event.data.tags)) return false;
  const tags = event.data.tags as Record<string, unknown>;
  if (tags.purpose !== "website_team_notice") return false;
  const result = await teamNoticeRpc(client, siteId, "receipt", {
    providerScope, svixId: event.svixId, eventType: event.type, eventCreatedAt: event.createdAt,
    emailId: event.data.email_id, broadcastId: event.data.broadcast_id,
    emailCreatedAt: event.data.created_at, from: event.data.from, to: event.data.to, subject: event.data.subject,
    tags: { purpose: tags.purpose, policy: tags.policy, notice_correlation: tags.notice_correlation },
  }) as { matched?: boolean } | null;
  return result?.matched === true;
}
