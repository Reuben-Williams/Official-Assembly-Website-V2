import { createInstallationCronHandler } from "../../../../../lib/control-plane/cron-handler";
import { createOfficialAssemblyInstallationRuntime } from "../../../../../lib/control-plane/site-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  return createInstallationCronHandler({
    secret: process.env.CRON_SECRET,
    runtimeFactory: createOfficialAssemblyInstallationRuntime
  })(request);
}
