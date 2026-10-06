import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/builder/request-auth", () => ({ authenticateBuilderRequest: mocks.authenticate }));
vi.mock("../lib/supabase/admin", () => ({ getBuilderAdminClient: () => ({ rpc: mocks.rpc }) }));
import { POST } from "../app/api/newsletter/operations/staff-auth-recovery/route";
const origin = "https://www.assemblywomanmorales.com";
const identity = { userId: "20000000-0000-4000-8000-000000000001", role: "owner", siteKey: "official-assembly-website-v2",
  siteId: "10000000-0000-4000-8000-000000000001", sessionGeneration: 3, tokenGeneration: 3, csrfToken: "csrf" };
const body = { requestId: "30000000-0000-4000-8000-000000000001", commandId: "40000000-0000-4000-8000-000000000001" };
const request = (value: unknown = body, headers = {}) => new Request(`${origin}/api/newsletter/operations/staff-auth-recovery`, {
  method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "x-builder-csrf": "csrf", ...headers }, body: JSON.stringify(value) });
beforeEach(() => { vi.clearAllMocks(); mocks.authenticate.mockResolvedValue(identity); mocks.rpc.mockResolvedValue({ data: "queued", error: null }); });
describe("owner-only accepted-delivery recovery route", () => {
  it("requires current owner membership, same origin and CSRF before database recovery", async () => {
    for (const candidate of [null, { ...identity, role: "editor" }, { ...identity, tokenGeneration: 2 }]) {
      mocks.authenticate.mockResolvedValue(candidate);
      expect((await POST(request())).status).toBeGreaterThanOrEqual(401);
    }
    mocks.authenticate.mockResolvedValue(identity);
    expect((await POST(request(body, { origin: "https://attacker.example" }))).status).toBe(403);
    expect((await POST(request(body, { "x-builder-csrf": "wrong" }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes only server identity and bounded UUIDs to the no-send operation", async () => {
    expect((await POST(request({ ...body, ownerId: "client-chosen" }))).status).toBe(400);
    expect((await POST(request({ ...body, requestId: "bad" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "queued" });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("builder_staff_auth_recover", {
      p_site_id: identity.siteId, p_owner_id: identity.userId, p_request_id: body.requestId, p_command_id: body.commandId });
  });
  it("does not disclose database errors or claim success on refused recovery", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "sensitive provider error" } });
    const response = await POST(request()); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("sensitive");
  });
});
