import { authenticateBuilderRequest } from "../../../../lib/builder/request-auth";
import { allowedBuilderOrigins } from "../../../../lib/builder/authorization";
import { getBuilderAdminClient } from "../../../../lib/supabase/admin";
import { createCarouselHandlers } from "../../../../lib/carousel/handlers";
import { createCarouselService } from "../../../../lib/carousel/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
async function handle(request: Request, method: "GET" | "POST") {
  const client = getBuilderAdminClient();
  if (!client)
    return Response.json(
      {
        error: {
          code: "UNAVAILABLE",
          message: "Carousel service is unavailable.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  const handlers = createCarouselHandlers({
    authenticate: authenticateBuilderRequest,
    service: createCarouselService(client),
    origins: allowedBuilderOrigins(new URL(request.url).origin),
  });
  return handlers[method](request);
}
export const GET = (request: Request) => handle(request, "GET");
export const POST = (request: Request) => handle(request, "POST");
