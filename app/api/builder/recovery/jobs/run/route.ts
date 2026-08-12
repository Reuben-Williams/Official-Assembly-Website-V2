import { createRecoveryCronHandler, createOfficialAssemblyRecoveryRuntime } from "../../../../../../lib/builder/recovery";
import {
  createCombinedRecoveryRunOnce,
  createOfficialAssemblyAlertRecoveryRuntime,
} from "../../../../../../lib/builder/alerts";
import { createOfficialAssemblyCompositionRecoveryRuntime } from "../../../../../../lib/builder/localization/recovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const recovery = createOfficialAssemblyRecoveryRuntime();
    const alerts = createOfficialAssemblyAlertRecoveryRuntime({
      environment: recovery.environment,
    });
    const composition = createOfficialAssemblyCompositionRecoveryRuntime();
    return createRecoveryCronHandler({
      secret: process.env.CRON_SECRET,
      runOnce: createCombinedRecoveryRunOnce({
        runContentOnce: recovery.runOnce,
        runAlertsOnce: alerts.runOnce,
        runCompositionOnce: composition.runOnce,
      }),
    })(request);
  } catch {
    return Response.json({ error: { code: "RECOVERY_WORKER_UNAVAILABLE" } }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}
