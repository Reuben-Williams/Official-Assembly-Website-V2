import { allowedBuilderOrigins, authorizeBuilderRequest, BuilderAuthorizationError } from "../../../../lib/builder/authorization";
import { authenticateBuilderRequest } from "../../../../lib/builder/request-auth";
import { getBuilderAdminClient } from "../../../../lib/supabase/admin";
import { listNormalizedMediaAssets } from "../../../../lib/builder/repositories";
import { EMPTY_MEDIA_LIBRARY, validateLibraryCommand } from "../../../../lib/builder/media-library";

export const dynamic = "force-dynamic";
const respond = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
async function handle(request: Request, write: boolean) {
  try {
    const identity = await authorizeBuilderRequest({ request, operation: write ? "media.create" : "media.read", allowedOrigins: allowedBuilderOrigins(new URL(request.url).origin), authenticate: () => authenticateBuilderRequest(request) });
    if (!identity) throw new BuilderAuthorizationError("AUTH_REQUIRED", 401, "Sign in to use the media library.");
    if (write && !["owner", "editor"].includes(identity.role)) throw new BuilderAuthorizationError("ROLE_DENIED", 403, "Only owners and editors can organize the media library.");
    const client = getBuilderAdminClient();
    if (!client) throw new Error("unavailable");
    if (!write) {
      const [state, assets] = await Promise.all([client.from("builder_media_library_state").select("version,state").eq("site_id", identity.siteId).maybeSingle(), listNormalizedMediaAssets(client, identity.siteId)]);
      if (state.error) throw state.error;
      return respond({ ...(state.data ?? EMPTY_MEDIA_LIBRARY), assets });
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new TypeError("A JSON request is required.");
    const raw = await request.text();
    if (raw.length > 16384) throw new TypeError("The request is too large.");
    const command = validateLibraryCommand(JSON.parse(raw));
    const result = await client.rpc("builder_media_library_command_v1", { p_site_id: identity.siteId, p_actor_id: identity.userId, p_generation: identity.sessionGeneration, p_expected_version: command.version, p_action: command.action, p_value: command.value });
    if (result.error) throw result.error;
    return respond(result.data);
  } catch (error) {
    if (error instanceof BuilderAuthorizationError) return respond({ error: error.message }, error.status);
    if (error instanceof TypeError || error instanceof SyntaxError) return respond({ error: error.message }, 400);
    const code = (error as { code?: string })?.code;
    if (code === "40001") return respond({ error: "The library changed in another session. Refresh, then try again." }, 409);
    if (code === "23505") return respond({ error: "A folder with this name already exists." }, 409);
    if (code === "42501") return respond({ error: "Your role or session changed. Sign in again." }, 403);
    if (code === "22023") return respond({ error: "This library action is invalid. Refresh and try again." }, 400);
    return respond({ error: "The media library is temporarily unavailable. Your images have not been removed." }, 503);
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
