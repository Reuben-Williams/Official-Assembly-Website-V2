import { describe, expect, it, vi } from "vitest";

import {
  OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION,
  createOfficialAssemblyGrowthHandlers,
  type OfficialAssemblyGrowthConfigurationAdapter
} from "../lib/control-plane/growth-command-handlers";

const lease = {
  siteId: "a3f57b25-df25-4d98-9ff6-a4a3f3a00a68",
  installationId: "bff572c6-e767-4c10-90d9-5816d17762cd",
  leaseOwner: "11111111-1111-4111-8111-111111111111",
  fencingToken: "1",
  leaseExpiresAt: "2026-08-05T23:59:59.000Z"
} as const;

describe("Official Assembly installation command handlers", () => {
  it("registers only the approved live growth configuration commands", () => {
    const adapter: OfficialAssemblyGrowthConfigurationAdapter = {
      applyConfiguration: vi.fn()
    };

    const handlers = createOfficialAssemblyGrowthHandlers(adapter);

    expect(handlers.map(({ type, version, idempotency }) => ({ type, version, idempotency })))
      .toEqual([
        { type: "growth.customers.configure", version: 1, idempotency: "commandId" },
        { type: "growth.leads.configure", version: 1, idempotency: "commandId" },
        { type: "growth.dashboard.configure", version: 1, idempotency: "commandId" }
      ]);
    expect(OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION).toBe("official-assembly-live-v1");
  });

  it("persists exact module versions without provider or placeholder payloads", async () => {
    const applyConfiguration = vi.fn(async (input) => ({
      moduleId: input.moduleId,
      moduleVersion: input.moduleVersion,
      configVersion: input.configVersion,
      configuration: input.configuration
    }));
    const handlers = createOfficialAssemblyGrowthHandlers({ applyConfiguration });
    const expected = [
      ["growth.customers", "1.0.1"],
      ["growth.leads", "1.0.1"],
      ["growth.dashboard", "2.0.1"]
    ];

    for (const [index, handler] of handlers.entries()) {
      const payload = handler.validate({ configuration: OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION });
      await expect(handler.execute({
        commandId: `00000000-0000-4000-8000-00000000000${index + 1}`,
        idempotencyKey: `official-assembly-${index + 1}`,
        payload,
        signal: new AbortController().signal,
        lease
      })).resolves.toMatchObject({
        resultCode: "GROWTH_CONFIGURATION_CONFIGURED",
        evidence: { codes: ["GROWTH_CONFIGURATION_CONFIGURED"] }
      });
    }

    expect(applyConfiguration.mock.calls.map(([input]) => [
      input.moduleId,
      input.moduleVersion,
      input.configuration
    ])).toEqual(expected.map(([moduleId, moduleVersion]) => [
      moduleId,
      moduleVersion,
      OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION
    ]));
    expect(JSON.stringify(applyConfiguration.mock.calls)).not.toMatch(/email|sms|ai|synthetic|placeholder/i);
  });

  it("rejects every configuration profile except the approved live profile", () => {
    const [handler] = createOfficialAssemblyGrowthHandlers({
      applyConfiguration: vi.fn()
    });

    expect(() => handler.validate({ configuration: "test-v1" })).toThrow(TypeError);
    expect(() => handler.validate({ configuration: OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION, demo: true }))
      .toThrow(TypeError);
  });
});
