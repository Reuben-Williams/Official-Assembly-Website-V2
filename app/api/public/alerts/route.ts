import {
  createOfficialAssemblyAlertHandlers,
  createOfficialAssemblyAlertRecoveryRuntime,
  createOfficialAssemblyAlertRepository,
} from "../../../../lib/builder/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const repository = createOfficialAssemblyAlertRepository();
  if (!repository) {
    return Response.json(
      { error: { code: "ALERTS_UNAVAILABLE", message: "Published alerts are temporarily unavailable." } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  let recovery: ReturnType<typeof createOfficialAssemblyAlertRecoveryRuntime> | null = null;
  try {
    recovery = createOfficialAssemblyAlertRecoveryRuntime();
  } catch {
    // The authoritative database read remains available without optional recovery storage.
  }
  return createOfficialAssemblyAlertHandlers({
    repository,
    environment: recovery?.environment ?? "production",
    recovery: recovery?.recovery,
  }).publicRead(request);
}
