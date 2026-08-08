import { readNewsletterProviderInventoryConfiguration } from "../../../../../lib/newsletter/config";
import {
  newsletterOperationBody,
  newsletterOperationCommandId,
  authorizeNewsletterOperation,
  newsletterOperationError
} from "../../../../../lib/newsletter/operations-route";
import {
  createNewsletterAuthSmtpProofDigest,
  createNewsletterProviderOperationsRepository,
  type NewsletterAuthSmtpProofKind
} from "../../../../../lib/newsletter/provider-operations-repository";
import {
  findRecentNewsletterAuthSmtpLoginEmail,
  REQUIRED_NEWSLETTER_API_KEY_NAMES
} from "../../../../../lib/newsletter/provider-inventory";
import {
  collectNewsletterProviderInventory,
  createProductionNewsletterInventoryReader
} from "../../../../../lib/newsletter/resend/inventory-adapter";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function proofKind(value: unknown): NewsletterAuthSmtpProofKind {
  if (value === "replacement_login" || value === "post_revocation_login") return value;
  throw new TypeError("The Auth SMTP proof phase is invalid.");
}

export async function POST(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, true, true);
    const body = await newsletterOperationBody(request, ["commandId", "phase"]);
    const commandId = newsletterOperationCommandId(body.commandId);
    const phase = proofKind(body.phase);
    const configuration = readNewsletterProviderInventoryConfiguration();
    if (configuration.status !== "ready") throw new Error("newsletter provider unavailable");

    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter database unavailable");

    const existing = await client
      .from("builder_newsletter_auth_smtp_proofs")
      .select("command_id,proof_kind,provider_message_id")
      .eq("site_id", identity.siteId);
    if (existing.error) throw new Error("newsletter Auth SMTP proof unavailable");
    const commandReplay = existing.data?.find((row) => row.command_id === commandId);
    if (commandReplay) {
      if (commandReplay.proof_kind !== phase) {
        throw new TypeError("The Auth SMTP proof command conflicts with its recorded phase.");
      }
      return Response.json({ state: "recorded", phase, replayed: true }, {
        headers: { "cache-control": "no-store" }
      });
    }

    const authUser = await client.auth.admin.getUserById(identity.userId);
    const email = authUser.data.user?.email?.trim() ?? "";
    const lastSignInAt = authUser.data.user?.last_sign_in_at ?? "";
    if (authUser.error || !email || !Number.isFinite(Date.parse(lastSignInAt))) {
      throw new Error("newsletter Auth SMTP login unavailable");
    }

    const snapshot = await collectNewsletterProviderInventory(
      createProductionNewsletterInventoryReader({
        managementApiKey: process.env.RESEND_MANAGEMENT_API_KEY!,
        sendApiKey: process.env.RESEND_SEND_API_KEY!,
        segmentId: configuration.segmentId
      })
    );

    if (phase === "post_revocation_login") {
      const exactKeyPolicy = snapshot.apiKeys.length === 3 &&
        new Set(snapshot.apiKeys.map((key) => key.id)).size === 3 &&
        REQUIRED_NEWSLETTER_API_KEY_NAMES.every((name) =>
          snapshot.apiKeys.filter((key) => key.name === name).length === 1
        );
      if (!exactKeyPolicy) throw new Error("legacy provider credential remains present");
    }

    const usedMessageIds = new Set(
      (existing.data ?? []).map((row) => String(row.provider_message_id ?? "")).filter(Boolean)
    );
    const message = findRecentNewsletterAuthSmtpLoginEmail(snapshot, {
      email,
      lastSignInAt: new Date(lastSignInAt),
      excludedProviderMessageIds: usedMessageIds
    });
    if (!message) throw new Error("verified Auth SMTP login message not found");

    const result = await createNewsletterProviderOperationsRepository(
      client,
      identity.siteId
    ).recordAuthSmtpProof({
      commandId,
      operatorId: identity.userId,
      proofKind: phase,
      providerMessageId: message.id,
      providerCreatedAt: message.createdAt,
      authLastSignInAt: new Date(lastSignInAt).toISOString(),
      safeEvidenceDigest: createNewsletterAuthSmtpProofDigest({
        siteId: identity.siteId,
        operatorId: identity.userId,
        proofKind: phase,
        providerMessageId: message.id,
        providerCreatedAt: message.createdAt,
        authLastSignInAt: new Date(lastSignInAt).toISOString()
      })
    });

    return Response.json({
      state: result.status === "recorded" ? "recorded" : "unavailable",
      phase,
      replayed: result.replayed === true
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return newsletterOperationError(error);
  }
}
