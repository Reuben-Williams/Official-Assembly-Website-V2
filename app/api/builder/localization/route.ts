import {
  allowedBuilderOrigins,
} from "../../../../lib/builder/authorization";
import { authenticateBuilderRequest } from "../../../../lib/builder/request-auth";
import {
  createBilingualEditorHandlers,
  createSupabaseBilingualEditorRepository,
} from "../../../../lib/builder/localization/server";
import { getBuilderAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable() {
  return Response.json({
    error: { code: "LOCALIZATION_UNAVAILABLE", message: "The bilingual publishing service is unavailable." },
  }, { status: 503, headers: { "cache-control": "no-store" } });
}

function handlers(request: Request) {
  const admin = getBuilderAdminClient();
  if (!admin) return null;
  return createBilingualEditorHandlers({
    repository: createSupabaseBilingualEditorRepository(admin),
    authenticate: authenticateBuilderRequest,
    allowedOrigins: allowedBuilderOrigins(new URL(request.url).origin),
  });
}

export async function GET(request: Request) {
  return handlers(request)?.GET(request) ?? unavailable();
}

export async function POST(request: Request) {
  return handlers(request)?.POST(request) ?? unavailable();
}
