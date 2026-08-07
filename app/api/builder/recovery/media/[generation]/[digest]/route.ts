import { createOfficialAssemblyRecoveryRuntime } from "../../../../../../../lib/builder/recovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ generation: string; digest: string }> }
) {
  try {
    const recovery = createOfficialAssemblyRecoveryRuntime();
    return recovery.mediaHandler(request, await context.params);
  } catch {
    return Response.json({ error: { code: "RECOVERY_MEDIA_UNAVAILABLE" } }, {
      status: 503,
      headers: { "cache-control": "private, no-store" }
    });
  }
}
