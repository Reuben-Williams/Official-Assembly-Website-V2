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

function runtimeDiagnostic(error: unknown) {
  const record = error && typeof error === "object"
    ? error as { name?: unknown; code?: unknown }
    : null;
  const safeValue = (value: unknown) =>
    typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value)
      ? value
      : null;
  return { name: safeValue(record?.name), code: safeValue(record?.code) };
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
    } catch (error) {
      console.error("installation_runtime_unavailable", runtimeDiagnostic(error));
      return json({ status: "unavailable" }, 503);
    }
  };
}
