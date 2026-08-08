import { createRecoveryCronHandler, createOfficialAssemblyRecoveryRuntime } from "../../../../../../lib/builder/recovery";
import {
  createCombinedRecoveryRunOnce,
  createOfficialAssemblyAlertRecoveryRuntime,
} from "../../../../../../lib/builder/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const recovery = createOfficialAssemblyRecoveryRuntime();
    const alerts = createOfficialAssemblyAlertRecoveryRuntime({
      environment: recovery.environment,
    });
    return createRecoveryCronHandler({
      secret: process.env.CRON_SECRET,
      runOnce: createCombinedRecoveryRunOnce({
        runContentOnce: recovery.runOnce,
        runAlertsOnce: alerts.runOnce,
      }),
    })(request);
  } catch {
    return Response.json({ error: { code: "RECOVERY_WORKER_UNAVAILABLE" } }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}
