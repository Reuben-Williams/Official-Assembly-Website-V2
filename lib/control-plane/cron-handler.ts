import "server-only";

import { timingSafeEqual } from "node:crypto";

import type { SiteInstallationRuntime } from "@reuben-williams/next/control-plane";

type RuntimeFactory = () => SiteInstallationRuntime | Promise<SiteInstallationRuntime>;

function authorized(header: string | null, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const received = Buffer.from(header ?? "", "utf8");
  return expected.byteLength === received.byteLength && timingSafeEqual(expected, received);
}

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

export function createInstallationCronHandler(input: {
  secret: string | undefined;
  runtimeFactory: RuntimeFactory;
}) {
  return async function GET(request: Request) {
    if (!input.secret) return json({ status: "unavailable" }, 503);
    if (!authorized(request.headers.get("authorization"), input.secret)) {
      return json({ status: "unauthorized" }, 401);
    }
    try {
      const runtime = await input.runtimeFactory();
      const result = await runtime.runScheduled();
      return json({ status: "ok", ...result }, 200);
    } catch {
      return json({ status: "unavailable" }, 503);
    }
  };
}
