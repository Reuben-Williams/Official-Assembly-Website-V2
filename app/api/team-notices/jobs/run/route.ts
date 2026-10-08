import { Resend } from "resend";
import { createNewsletterCronHandler } from "../../../../../lib/newsletter/cron-handler";
import { readNewsletterConfiguration } from "../../../../../lib/newsletter/config";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../../../../../lib/supabase/admin";
import { runTeamNoticeWorker } from "../../../../../lib/team-notices/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET(request: Request) {
  return createNewsletterCronHandler({ secret: process.env.CRON_SECRET, workerFactory: async () => {
    const client = getBuilderAdminClient();
    const key = process.env.RESEND_SEND_API_KEY;
    if (!client || !key || readNewsletterConfiguration().status !== "ready") throw new Error("notice service unavailable");
    const siteId = await resolveBuilderSiteId(client);
    if (!siteId) throw new Error("notice service unavailable");
    const provider = new Resend(key);
    return { run: () => runTeamNoticeWorker({ client, siteId, send: (payload, options) => provider.emails.send(payload, options) }) };
  } })(request);
}
