import { describe, expect, it, vi } from "vitest";

import { createNewsletterBroadcastAuditHandler } from "../lib/newsletter/broadcast-audit";

describe("newsletter broadcast audit handler", () => {
  it("marks the job as already completed after the final atomic audit checkpoint", async () => {
    const audit = vi.fn(async () => undefined);
    const handler = createNewsletterBroadcastAuditHandler({ audit });
    const job = {
      subject: "broadcast" as const,
      id: "job-broadcast-audit",
      kind: "newsletter.broadcast.audit" as const,
      fencingToken: 9
    };

    await expect(handler(job)).resolves.toEqual({
      code: "audit_complete",
      alreadyCompleted: true
    });
    expect(audit).toHaveBeenCalledWith(job);
  });
});
