import { describe, expect, it } from "vitest";

import { verifyGrowthMutationCsrf } from "../lib/growth/server";

const identity = {
  userId: "34300000-0000-4000-8000-000000000001",
  role: "owner" as const,
  siteKey: "official-assembly-website-v2",
  siteId: "34000000-0000-4000-8000-000000000001",
  sessionGeneration: 2,
  tokenGeneration: 2,
  csrfToken: "current-csrf-token"
};

describe("growth mutation CSRF", () => {
  it("accepts the token embedded in the verified editor session", () => {
    expect(() => verifyGrowthMutationCsrf(identity, "current-csrf-token")).not.toThrow();
  });

  it.each([null, "", "stale-csrf-token"])("rejects an invalid token before persistence", (token) => {
    expect(() => verifyGrowthMutationCsrf(identity, token)).toThrow(expect.objectContaining({
      name: "GrowthMutationCsrfError",
      code: "CSRF_REJECTED",
      status: 403
    }));
  });
});
