import {
  evaluateNewsletterProviderInventory,
  disabledNewsletterInventoryCanEnterInitialActivation,
  resolveNewsletterInventoryActivationStage,
  type NewsletterInventoryStage
} from "../../../../../lib/newsletter/provider-inventory";
import { createNewsletterProviderInventoryEvidenceRepository } from "../../../../../lib/newsletter/provider-inventory-repository";
import { readNewsletterProviderInventoryConfiguration } from "../../../../../lib/newsletter/config";
import {
  authorizeNewsletterOperation,
  newsletterOperationError
} from "../../../../../lib/newsletter/operations-route";
import { createProductionNewsletterInventoryReader, collectNewsletterProviderInventory } from "../../../../../lib/newsletter/resend/inventory-adapter";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, false, true);
    const configuration = readNewsletterProviderInventoryConfiguration();
    if (configuration.status !== "ready") {
      return Response.json({ state: "unavailable", code: configuration.code }, {
        status: 503,
        headers: { "cache-control": "no-store" }
      });
    }
    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter inventory database unavailable");

    const reader = createProductionNewsletterInventoryReader({
      managementApiKey: process.env.RESEND_MANAGEMENT_API_KEY!,
      sendApiKey: process.env.RESEND_SEND_API_KEY!,
      segmentId: configuration.segmentId
    });
    const snapshot = await collectNewsletterProviderInventory(reader);
    const evidence = await createNewsletterProviderInventoryEvidenceRepository(
      client,
      identity.siteId
    ).read();
    const emailEnabled = process.env.NEWSLETTER_EMAIL_ENABLED === "true";
    const initial = evaluateNewsletterProviderInventory({
      stage: emailEnabled ? "initial" : "disabled_setup",
      configuration,
      snapshot,
      evidence
    });
    let result = initial;
    if (!emailEnabled && disabledNewsletterInventoryCanEnterInitialActivation(initial)) {
      result = evaluateNewsletterProviderInventory({
        stage: "initial",
        configuration,
        snapshot,
        evidence
      });
    }
    if (emailEnabled) {
      const activeDigest = await createNewsletterProviderInventoryEvidenceRepository(
        client,
        identity.siteId
      ).activeActivationDigest();
      const stage: NewsletterInventoryStage = resolveNewsletterInventoryActivationStage(
        activeDigest,
        initial.resourceIdentityDigest
      );
      if (stage === "steady") {
        result = evaluateNewsletterProviderInventory({
          stage,
          configuration,
          snapshot,
          evidence
        });
      }
    }
    const { resourceIdentityDigest: _serverOnlyDigest, ...safeResult } = result;

    return Response.json(safeResult, {
      status: result.state === "ready" ? 200 : 409,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return newsletterOperationError(error);
  }
}
