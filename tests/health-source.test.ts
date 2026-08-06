import { describe, expect, it } from "vitest";

import { createOfficialAssemblyHealthSource } from "../lib/control-plane/health-source";

describe("Official Assembly installation health", () => {
  it("omits optional provider integrations when no provider is configured", async () => {
    const source = createOfficialAssemblyHealthSource(
      {} as Parameters<typeof createOfficialAssemblyHealthSource>[0],
      "a3f57b25-df25-4d98-9ff6-a4a3f3a00a68"
    );

    await expect(source.probeIntegrations()).resolves.toEqual({});
  });
});
