import { readNewsletterConfiguration } from "../../../../lib/newsletter/config";
import { createNewsletterConfirmationRepository } from "../../../../lib/newsletter/confirmation-repository";
import { handleNewsletterConfirmationRequest } from "../../../../lib/newsletter/confirmation-session";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable() {
  return Response.json(
    { error: { code: "CONFIRMATION_UNAVAILABLE" } },
    { status: 503, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } }
  );
}

export async function POST(request: Request) {
  const configuration = readNewsletterConfiguration();
  const client = getBuilderAdminClient();
  if (configuration.status !== "ready" || !client) return unavailable();
  const siteId = await resolveBuilderSiteId(client);
  if (!siteId) return unavailable();
  const repository = createNewsletterConfirmationRepository(client);
  return handleNewsletterConfirmationRequest(request, {
    confirm: ({ sessionDigest }) => repository.confirm({ siteId, sessionDigest })
  });
}
