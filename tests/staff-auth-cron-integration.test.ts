import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ accounting: vi.fn(), ordinary: vi.fn(), housekeeping: vi.fn(), schedule: vi.fn() }));
vi.mock("../lib/supabase/admin", () => ({ getBuilderAdminClient: () => ({}), resolveBuilderSiteId: async () => "site" }));
vi.mock("../lib/newsletter/config", () => ({ readNewsletterConfiguration: () => ({ status: "unavailable" }) }));
vi.mock("../lib/newsletter/job-repository", () => ({ createSupabaseNewsletterJobRepository: () => ({}),
  createSupabaseNewsletterSubscriptionJobData: () => ({}), createSupabaseNewsletterAuditData: () => ({}),
  createSupabaseNewsletterReconciliationData: () => ({ housekeeping: mocks.housekeeping, schedule: mocks.schedule }) }));
vi.mock("../lib/newsletter/staff-auth-repository", () => ({ createStaffAccountingRepository: () => ({}) }));
vi.mock("../lib/newsletter/staff-auth-worker", () => ({ runStaffDeliveryAccounting: mocks.accounting }));
vi.mock("../lib/newsletter/worker", async (original) => ({ ...await original<typeof import("../lib/newsletter/worker")>(), runNewsletterWorker: mocks.ordinary }));
import { GET } from "../app/api/newsletter/jobs/run/route";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });
describe("staff accounting cron integration", () => {
  it("runs metadata-only accounting first while outbound sending is disabled and shares the remaining budget", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret"); vi.stubEnv("RESEND_MANAGEMENT_API_KEY", "local-test-only");
    let now = 1000; vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.accounting.mockImplementation(async () => { now += 14000; });
    mocks.ordinary.mockResolvedValue({ claimed: 0, completed: 0, failed: 0, blocked: 0 });
    const response = await GET(new Request("https://www.assemblywomanmorales.com/api/newsletter/jobs/run", { headers: { authorization: "Bearer cron-secret" } }));
    expect(response.status).toBe(200);
    expect(mocks.accounting).toHaveBeenCalledWith(expect.objectContaining({ maximumDurationMs: 15000 }));
    expect(mocks.accounting.mock.invocationCallOrder[0]).toBeLessThan(mocks.housekeeping.mock.invocationCallOrder[0]!);
    expect(mocks.ordinary).toHaveBeenCalledWith(expect.objectContaining({ maximumDurationMs: 14000, emailEnabled: false, limit: 10 }));
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
