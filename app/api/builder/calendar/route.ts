import { createCalendarRouteHandlers } from "../../../../lib/calendar/repository";
import { createSupabaseCalendarRepository } from "../../../../lib/calendar/supabase-repository";
import { getBuilderAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable() {
  return Response.json(
    { error: { code: "UNAVAILABLE", message: "The calendar service is temporarily unavailable." } },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}

export async function GET(request: Request) {
  const client = getBuilderAdminClient();
  if (!client) return unavailable();
  return createCalendarRouteHandlers({
    repository: createSupabaseCalendarRepository(client)
  }).list(request);
}
