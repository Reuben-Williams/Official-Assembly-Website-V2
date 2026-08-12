import { createHash } from "node:crypto";

import { inspectNewsletterBroadcast } from "../../../../../lib/newsletter/broadcast-operations";
import { createNewsletterBroadcastRepository } from "../../../../../lib/newsletter/broadcast-repository";
import { createSupabaseNewsletterReconciliationRequestRepository } from "../../../../../lib/newsletter/job-repository";
import {
  authorizeNewsletterOperation,
  newsletterOperationBody,
  newsletterOperationError,
  requireReadyNewsletterConfiguration
} from "../../../../../lib/newsletter/operations-route";
import { createProductionNewsletterBroadcastProvider } from "../../../../../lib/newsletter/resend/client";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, true);
    const body = await newsletterOperationBody(request, ["broadcastId", "commandId"]);
    const broadcastId = String(body.broadcastId ?? "");
    const commandId = String(body.commandId ?? "");
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(broadcastId) || !/^[0-9a-f-]{36}$/i.test(commandId)) {
      throw new TypeError("Invalid staff-test request");
    }
    const configuration = requireReadyNewsletterConfiguration();
    const key = process.env.RESEND_MANAGEMENT_API_KEY!;
    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter database unavailable");
    const repository = createNewsletterBroadcastRepository(client, identity.siteId);
    const readiness = await createSupabaseNewsletterReconciliationRequestRepository(client, identity.siteId)
      .request({ commandId, operation: "staff_test" });
    if (readiness.status !== "ready") {
      return Response.json({ state: readiness.status, commandId }, {
        status: readiness.status === "pending" ? 202 : 409,
        headers: { "cache-control": "no-store" }
      });
    }
    const inspected = await inspectNewsletterBroadcast(createProductionNewsletterBroadcastProvider(key), {
      broadcastId,
      segmentId: configuration.segmentId,
      topicId: configuration.topicId,
      readiness
    });
    const allowlist: unknown = JSON.parse(process.env.NEWSLETTER_TEST_RECIPIENTS ?? "[]");
    if (!Array.isArray(allowlist) || !allowlist.every((value) => typeof value === "string")) {
      throw new Error("staff-test allowlist unavailable");
    }
    const recipientFingerprint = createHash("sha256")
      .update(allowlist.map((value) => value.toLowerCase()).sort().join("\n"), "utf8")
      .digest("hex");
    const opened = await repository.openStaffTestWindow({
      commandId,
      operatorId: identity.userId,
      providerBroadcastId: broadcastId,
      digest: inspected.digest,
      allowlistRevision: recipientFingerprint.slice(0, 16),
      recipientFingerprint
    });
    return Response.json({ ...opened, broadcastId, digest: inspected.digest }, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return newsletterOperationError(error);
  }
}
