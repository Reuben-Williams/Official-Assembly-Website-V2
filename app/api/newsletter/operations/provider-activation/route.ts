import { readNewsletterConfiguration, readNewsletterProviderInventoryConfiguration } from "../../../../../lib/newsletter/config";
import { authorizeNewsletterOperation, newsletterOperationBody, newsletterOperationCommandId, newsletterOperationError } from "../../../../../lib/newsletter/operations-route";
import { evaluateNewsletterProviderInventory } from "../../../../../lib/newsletter/provider-inventory";
import { createNewsletterProviderInventoryEvidenceRepository } from "../../../../../lib/newsletter/provider-inventory-repository";
import { createNewsletterProviderOperationsRepository } from "../../../../../lib/newsletter/provider-operations-repository";
import { collectNewsletterProviderInventory, createProductionNewsletterInventoryReader } from "../../../../../lib/newsletter/resend/inventory-adapter";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, true, true);
    const body = await newsletterOperationBody(request, ["commandId"]);
    const commandId = newsletterOperationCommandId(body.commandId);
    const structural = readNewsletterConfiguration();
    const configuration = readNewsletterProviderInventoryConfiguration();
    if ((structural.status !== "ready" && structural.status !== "disabled")
      || configuration.status !== "ready") {
      throw new Error("newsletter activation unavailable");
    }
    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter database unavailable");
    const evidenceRepository = createNewsletterProviderInventoryEvidenceRepository(
      client,
      identity.siteId
    );
    const snapshot = await collectNewsletterProviderInventory(
      createProductionNewsletterInventoryReader({
        managementApiKey: process.env.RESEND_MANAGEMENT_API_KEY!,
        sendApiKey: process.env.RESEND_SEND_API_KEY!,
        segmentId: configuration.segmentId
      })
    );
    const evidence = await evidenceRepository.read();
    const result = evaluateNewsletterProviderInventory({
      stage: "initial",
      configuration,
      snapshot,
      evidence
    });
    const activeDigest = await evidenceRepository.activeActivationDigest();
    if (activeDigest) {
      if (activeDigest !== result.resourceIdentityDigest) {
        throw new Error("provider identity changed");
      }
      return Response.json({ state: "active", replayed: true }, {
        headers: { "cache-control": "no-store" }
      });
    }
    if (!result.activationReady || result.state !== "ready"
      || result.counts.segmentContacts !== 0
      || result.counts.localEligible !== 0
      || result.counts.sentBroadcasts !== 0) {
      return Response.json({
        state: "blocked",
        categories: result.categories.map(({ category, status, code, count }) => ({
          category, status, code, count
        }))
      }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    const activation = await createNewsletterProviderOperationsRepository(
      client,
      identity.siteId
    ).activate({
      commandId,
      operatorId: identity.userId,
      resourceIdentityDigest: result.resourceIdentityDigest
    });
    return Response.json({
      state: activation.status === "active" ? "active" : "unavailable",
      replayed: activation.replayed === true
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return newsletterOperationError(error);
  }
}
