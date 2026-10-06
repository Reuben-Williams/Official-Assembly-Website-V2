import { describe, expect, it, vi } from "vitest";
import { createStaffSignInHandler, type StaffSignInDependencies } from "../lib/builder/staff-sign-in";
const origin = "https://www.assemblywomanmorales.com";
const reservedAt = "2026-10-06T12:00:00.000Z";
const body = (value: unknown = { email: " Staff@example.com ", returnTo: "/admin/editor?workspace=website.forms" }, extra = {}) =>
  new Request(`${origin}/api/builder/sign-in`, { method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", ...extra }, body: JSON.stringify(value) });
function setup() {
  const reserve = vi.fn(async () => ({ id: "request-id", reservedAt }));
  const finalize = vi.fn(async () => "accepted");
  const send = vi.fn<StaffSignInDependencies["send"]>(async () => ({ error: null as unknown }));
  return { reserve, finalize, send, handler: createStaffSignInHandler({ origins: [origin], canonicalOrigin: origin,
    reserve, finalize, send, now: () => Date.parse(reservedAt), timeoutMs: 10 }) };
}
describe("bounded staff sign-in", () => {
  it("normalizes input, reserves before Auth, prevents signup and uses trusted callback", async () => {
    const s = setup(); const response = await s.handler(body());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(s.reserve).toHaveBeenCalledWith("staff@example.com");
    expect(s.reserve.mock.invocationCallOrder[0]).toBeLessThan(s.send.mock.invocationCallOrder[0]!);
    expect(s.send).toHaveBeenCalledWith({ email: "staff@example.com", options: { shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/callback?next=%2Fadmin%2Feditor%3Fworkspace%3Dwebsite.forms` } });
    expect(s.finalize).toHaveBeenCalledWith("request-id", "accepted", "auth_accepted");
    expect(JSON.stringify(await response.json())).not.toContain("request-id");
  });
  it("does not send to unknown, unconfirmed, removed or limited targets and conceals them", async () => {
    const s = setup(); s.reserve.mockResolvedValueOnce(null as never);
    const response = await s.handler(body());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "requested" });
    expect(s.send).not.toHaveBeenCalled(); expect(s.finalize).not.toHaveBeenCalled();
  });
  it("rejects origin/body injection before database access", async () => {
    for (const request of [body(undefined, { origin: "https://evil.example" }),
      body(undefined, { "sec-fetch-site": "cross-site" }), body({ email: "a@b.com", userId: "attacker" }),
      body({ email: "a" }), body({ email: "x".repeat(10000) })]) {
      const s = setup(); expect((await s.handler(request)).status).toBeGreaterThanOrEqual(400);
      expect(s.reserve).not.toHaveBeenCalled(); expect(s.send).not.toHaveBeenCalled();
    }
  });
  it("uses a safe fallback for external redirect paths", async () => {
    const s = setup(); await s.handler(body({ email: "a@b.com", returnTo: "//evil.example" }));
    expect(s.send.mock.calls[0]?.[0].options.emailRedirectTo).toBe(`${origin}/auth/callback?next=%2Fadmin%2Feditor`);
  });
  it("finalizes definite rejection without returning Auth payload", async () => {
    const s = setup(); s.send.mockResolvedValueOnce({ error: { message: "private address error" } });
    const response = await s.handler(body());
    expect(s.finalize).toHaveBeenCalledWith("request-id", "failed", "auth_rejected");
    expect(await response.json()).toEqual({ status: "requested" });
  });
  it("never dispatches after the five-second reservation deadline", async () => {
    const s = setup(); const handler = createStaffSignInHandler({ ...s, origins: [origin], canonicalOrigin: origin,
      now: () => Date.parse(reservedAt) + 5001 });
    await handler(body()); expect(s.send).not.toHaveBeenCalled();
    expect(s.finalize).toHaveBeenCalledWith("request-id", "failed", "dispatch_expired_no_send");
  });
  it("times out uncertain without retrying or promoting a late success", async () => {
    const s = setup(); let resolve!: (value: { error: null }) => void;
    s.send.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    await s.handler(body());
    expect(s.finalize).toHaveBeenCalledWith("request-id", "uncertain", "auth_uncertain");
    resolve({ error: null }); await Promise.resolve();
    expect(s.send).toHaveBeenCalledTimes(1); expect(s.finalize).toHaveBeenCalledTimes(1);
  });
  it("records uncertainty when acceptance persistence fails", async () => {
    const s = setup(); s.finalize.mockRejectedValueOnce(new Error("private payload"));
    expect((await s.handler(body())).status).toBe(503);
    expect(s.finalize).toHaveBeenLastCalledWith("request-id", "uncertain", "outcome_unpersisted");
    expect(s.send).toHaveBeenCalledTimes(1);
  });
});
