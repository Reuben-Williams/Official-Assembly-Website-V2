import "server-only";

import { timingSafeEqual } from "node:crypto";

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const received = Buffer.from(header ?? "", "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function createNewsletterCronHandler(input: {
  readonly secret: string | undefined;
  readonly workerFactory: () => Promise<{
    readonly run: () => Promise<{
      readonly claimed: number;
      readonly completed: number;
      readonly failed: number;
      readonly blocked: number;
    }>;
  }> | {
    readonly run: () => Promise<{
      readonly claimed: number;
      readonly completed: number;
      readonly failed: number;
      readonly blocked: number;
    }>;
  };
}) {
  return async function GET(request: Request) {
    if (!input.secret) return json({ status: "unavailable" }, 503);
    if (!authorized(request.headers.get("authorization"), input.secret)) {
      return json({ status: "unauthorized" }, 401);
    }
    try {
      const worker = await input.workerFactory();
      return json({ status: "ok", ...(await worker.run()) }, 200);
    } catch {
      console.error("newsletter_worker_unavailable", { code: "worker_unavailable" });
      return json({ status: "unavailable" }, 503);
    }
  };
}
