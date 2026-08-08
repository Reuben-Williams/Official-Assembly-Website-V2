import { createOfficialAssemblyAlertHandlers, createOfficialAssemblyAlertRepository } from "../../../../lib/builder/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable() {
  return Response.json(
    { error: { code: "ALERT_SERVER_UNAVAILABLE", message: "The alert service is unavailable." } },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

function handlers() {
  const repository = createOfficialAssemblyAlertRepository();
  return repository ? createOfficialAssemblyAlertHandlers({ repository }) : null;
}

export async function GET(request: Request) {
  return handlers()?.read(request) ?? unavailable();
}
