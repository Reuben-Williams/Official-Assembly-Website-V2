import {
  createNewsletterProviderAttestationDigest,
  createNewsletterProviderOperationsRepository
} from "../../../../../lib/newsletter/provider-operations-repository";
import {
  authorizeNewsletterOperation,
  newsletterOperationBody,
  newsletterOperationCommandId,
  newsletterOperationError
} from "../../../../../lib/newsletter/operations-route";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, true, true);
    const body = await newsletterOperationBody(request, ["commandId", "confirmed"]);
    const commandId = newsletterOperationCommandId(body.commandId);
    if (body.confirmed !== true) throw new TypeError("The dashboard review was not confirmed.");
    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter database unavailable");
    const result = await createNewsletterProviderOperationsRepository(
      client,
      identity.siteId
    ).recordAttestation({
      commandId,
      operatorId: identity.userId,
      safeEvidenceDigest: createNewsletterProviderAttestationDigest({
        siteId: identity.siteId,
        operatorId: identity.userId,
        observedAt: new Date()
      })
    });
    return Response.json({
      state: result.status === "recorded" ? "recorded" : "unavailable",
      replayed: result.replayed === true
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return newsletterOperationError(error);
  }
}
