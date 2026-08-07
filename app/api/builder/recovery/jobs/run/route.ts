import { createRecoveryCronHandler, createOfficialAssemblyRecoveryRuntime } from "../../../../../../lib/builder/recovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const recovery = createOfficialAssemblyRecoveryRuntime();
    return createRecoveryCronHandler({
      secret: process.env.CRON_SECRET,
      runOnce: recovery.runOnce
    })(request);
  } catch {
    return Response.json({ error: { code: "RECOVERY_WORKER_UNAVAILABLE" } }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}
