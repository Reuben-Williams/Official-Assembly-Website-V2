import {
  allowedBuilderOrigins,
  authorizeBuilderRequest,
  BuilderAuthorizationError,
} from "../../../../../lib/builder/authorization";
import { authenticateBuilderRequest } from "../../../../../lib/builder/request-auth";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";
import { verifyExistingMediaInventory } from "../../../../../lib/builder/media-inventory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const identity = await authorizeBuilderRequest({
      request,
      operation: "media.create",
      allowedOrigins: allowedBuilderOrigins(new URL(request.url).origin),
      authenticate: () => authenticateBuilderRequest(request),
    });
    if (!identity || identity.role !== "owner")
      return Response.json(
        {
          error: {
            message: "Only the site owner can verify the media library.",
          },
        },
        { status: 403, headers },
      );
    const client = getBuilderAdminClient();
    if (!client) throw new Error("unavailable");
    const result = await verifyExistingMediaInventory(client, identity);
    return Response.json(result, {
      status: result.status === "succeeded" ? 200 : 409,
      headers,
    });
  } catch (error) {
    return Response.json(
      {
        error: {
          message:
            error instanceof BuilderAuthorizationError
              ? error.message
              : "Media verification could not finish. No image was changed.",
        },
      },
      {
        status: error instanceof BuilderAuthorizationError ? error.status : 503,
        headers,
      },
    );
  }
}
