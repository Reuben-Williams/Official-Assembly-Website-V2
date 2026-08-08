import { readNewsletterConfiguration } from "../../../../lib/newsletter/config";
import {
  readNewsletterConfirmationKeyring,
  verifyNewsletterConfirmationToken
} from "../../../../lib/newsletter/confirmation-token";
import { createNewsletterConfirmationRepository } from "../../../../lib/newsletter/confirmation-repository";
import { handleNewsletterConfirmationSessionRequest } from "../../../../lib/newsletter/confirmation-session";
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
  const keyring = readNewsletterConfirmationKeyring();
  const client = getBuilderAdminClient();
  if (configuration.status !== "ready" || !keyring || !client) return unavailable();
  const siteId = await resolveBuilderSiteId(client);
  if (!siteId) return unavailable();
  const repository = createNewsletterConfirmationRepository(client);

  return handleNewsletterConfirmationSessionRequest(request, {
    verifyToken: (token) => {
      const payload = verifyNewsletterConfirmationToken(token, keyring.keys);
      if (payload.site !== siteId) throw new Error("invalid newsletter confirmation token");
      return payload;
    },
    exchange: repository.exchange
  });
}
