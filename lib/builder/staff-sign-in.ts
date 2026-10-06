import "server-only";
import { assertRequestOrigin, isSafeReturnPath } from "./authorization";

export type StaffSignInDependencies = {
  origins: readonly string[]; canonicalOrigin: string;
  reserve: (email: string) => Promise<{ id: string; reservedAt: string } | null>;
  finalize: (id: string, state: "accepted" | "failed" | "uncertain", code: string) => Promise<string>;
  send: (input: { email: string; options: { shouldCreateUser: false; emailRedirectTo: string } }) => Promise<{ error: unknown }>;
  now?: () => number; timeoutMs?: number;
};
function json(status: number, state: string) {
  return Response.json({ status: state }, { status, headers: { "cache-control": "no-store" } });
}
async function signInBody(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json" || !request.body) throw new TypeError();
  const reader = request.body.getReader(); const parts: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > 2048) { await reader.cancel(); throw new TypeError(); }
      parts.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError();
  const values = body as Record<string, unknown>;
  if (Object.keys(values).some((key) => !["email", "returnTo"].includes(key)) || typeof values.email !== "string") throw new TypeError();
  const email = values.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TypeError();
  const returnTo = typeof values.returnTo === "string" && values.returnTo.length <= 1000 && isSafeReturnPath(values.returnTo)
    ? values.returnTo : "/admin/editor";
  return { email, returnTo };
}
export function createStaffSignInHandler(input: StaffSignInDependencies) {
  return async (request: Request) => {
    try { assertRequestOrigin(request, input.origins); } catch { return json(403, "rejected"); }
    let body: Awaited<ReturnType<typeof signInBody>>;
    try { body = await signInBody(request); } catch { return json(400, "invalid"); }
    let reservation: { id: string; reservedAt: string } | null;
    try { reservation = await input.reserve(body.email); } catch { return json(503, "unavailable"); }
    if (!reservation) return json(200, "requested");
    const now = input.now ?? Date.now;
    try {
      const age = now() - Date.parse(reservation.reservedAt);
      if (!Number.isFinite(age) || age < -5000 || age > 5000) {
        await input.finalize(reservation.id, "failed", "dispatch_expired_no_send");
        return json(200, "requested");
      }
      const callback = new URL("/auth/callback", input.canonicalOrigin);
      callback.searchParams.set("next", body.returnTo);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let state: "accepted" | "failed" | "uncertain" = "uncertain";
      let code = "auth_uncertain";
      try {
        const outcome = await Promise.race([
          input.send({ email: body.email, options: { shouldCreateUser: false, emailRedirectTo: callback.toString() } }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), Math.min(input.timeoutMs ?? 10000, 10000)); })
        ]);
        state = outcome.error ? "failed" : "accepted";
        code = outcome.error ? "auth_rejected" : "auth_accepted";
      } catch { /* Transport failure does not prove that no email was sent. */ }
      finally { if (timer) clearTimeout(timer); }
      await input.finalize(reservation.id, state, code);
      return json(200, "requested");
    } catch {
      try { await input.finalize(reservation.id, "uncertain", "outcome_unpersisted"); } catch { /* Housekeeping seals interrupted reservations. */ }
      return json(503, "unavailable");
    }
  };
}
