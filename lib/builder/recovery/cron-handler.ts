import { timingSafeEqual } from "node:crypto";

function authorized(request: Request, secret: string | undefined) {
  const header = request.headers.get("authorization");
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
export function createRecoveryCronHandler(input: {
  secret: string | undefined;
  runOnce: () => Promise<unknown>;
}) {
  return async (request: Request) => {
    if (!authorized(request, input.secret)) {
      return Response.json({ error: { code: "AUTH_REQUIRED" } }, {
        status: 401,
        headers: { "cache-control": "no-store" }
      });
    }
    try {
      const result = await input.runOnce();
      return Response.json(result, { headers: { "cache-control": "no-store" } });
    } catch {
      return Response.json({ error: { code: "RECOVERY_WORKER_UNAVAILABLE" } }, {
        status: 503,
        headers: { "cache-control": "no-store" }
      });
    }
  };
}
