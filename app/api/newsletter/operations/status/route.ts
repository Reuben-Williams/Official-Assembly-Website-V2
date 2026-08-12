import { createNewsletterBroadcastRepository } from "../../../../../lib/newsletter/broadcast-repository";
import { createNewsletterProviderOperationsRepository } from "../../../../../lib/newsletter/provider-operations-repository";
import {
  authorizeNewsletterOperation,
  newsletterOperationError
} from "../../../../../lib/newsletter/operations-route";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, false);
    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter database unavailable");
    const [status, providerStatus] = await Promise.all([
      createNewsletterBroadcastRepository(client, identity.siteId).status(),
      createNewsletterProviderOperationsRepository(client, identity.siteId).status()
    ]);
    return Response.json({ ...status, ...providerStatus, role: identity.role }, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return newsletterOperationError(error);
  }
}
