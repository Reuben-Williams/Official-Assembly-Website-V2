import { createOfficialAssemblyAlertHandlers, createOfficialAssemblyAlertRepository } from "../../../../../lib/builder/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable() {
  return Response.json(
    { error: { code: "ALERT_SERVER_UNAVAILABLE", message: "The alert service is unavailable." } },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ command: string }> },
) {
  const repository = createOfficialAssemblyAlertRepository();
  if (!repository) return unavailable();
  const { command } = await context.params;
  const handlers = createOfficialAssemblyAlertHandlers({ repository });
  if (command === "initialize") return handlers.initialize(request);
  if (command === "command") return handlers.command(request);
  return Response.json(
    { error: { code: "ROUTE_NOT_FOUND", message: "The alert route was not found." } },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}
