import "server-only";

import { createHash } from "node:crypto";

import type {
  ProvisioningSiteCommandHandler,
  SiteCommandLeaseContext
} from "@reuben-williams/next/control-plane";

export const OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION = "official-assembly-live-v1" as const;

const CONFIG_VERSION = "1" as const;
const MODULES = [
  { type: "growth.customers.configure", moduleId: "growth.customers", moduleVersion: "1.0.1" },
  { type: "growth.leads.configure", moduleId: "growth.leads", moduleVersion: "1.0.1" },
  { type: "growth.dashboard.configure", moduleId: "growth.dashboard", moduleVersion: "2.0.1" }
] as const;

export type OfficialAssemblyGrowthConfigurationInput = {
  commandId: string;
  moduleId: (typeof MODULES)[number]["moduleId"];
  moduleVersion: (typeof MODULES)[number]["moduleVersion"];
  configVersion: typeof CONFIG_VERSION;
  configuration: typeof OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION;
  signal: AbortSignal;
  lease: SiteCommandLeaseContext;
};

type ConfigurationIdentity = Pick<
  OfficialAssemblyGrowthConfigurationInput,
  "moduleId" | "moduleVersion" | "configVersion" | "configuration"
>;

export interface OfficialAssemblyGrowthConfigurationAdapter {
  applyConfiguration(input: OfficialAssemblyGrowthConfigurationInput): Promise<ConfigurationIdentity>;
}

export interface OfficialAssemblyGrowthRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

function exactConfigurationPayload(value: unknown) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new TypeError("Invalid payload");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    record.configuration !== OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION
  ) throw new TypeError("Invalid payload");
  return { configuration: OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION };
}

function assertIdentity(value: unknown, expected: ConfigurationIdentity): asserts value is ConfigurationIdentity {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Configuration mismatch");
  const identity = value as Record<string, unknown>;
  if (
    Object.keys(identity).sort().join(",") !== "configVersion,configuration,moduleId,moduleVersion" ||
    identity.moduleId !== expected.moduleId ||
    identity.moduleVersion !== expected.moduleVersion ||
    identity.configVersion !== expected.configVersion ||
    identity.configuration !== expected.configuration
  ) throw new Error("Configuration mismatch");
}

function configurationDigest(identity: ConfigurationIdentity) {
  return createHash("sha256").update(JSON.stringify({
    configVersion: identity.configVersion,
    configuration: identity.configuration,
    moduleId: identity.moduleId,
    moduleVersion: identity.moduleVersion
  }), "utf8").digest("hex");
}

export function createSupabaseOfficialAssemblyGrowthConfigurationAdapter(
  client: OfficialAssemblyGrowthRpcClient
): OfficialAssemblyGrowthConfigurationAdapter {
  return {
    async applyConfiguration(input) {
      if (input.signal.aborted) throw input.signal.reason ?? new Error("Invocation aborted");
      const response = await client.rpc(
        "builder_apply_official_assembly_live_growth_configuration",
        {
          p_site_id: input.lease.siteId,
          p_installation_id: input.lease.installationId,
          p_lease_owner: input.lease.leaseOwner,
          p_fencing_token: input.lease.fencingToken,
          p_command_id: input.commandId,
          p_module_id: input.moduleId,
          p_module_version: input.moduleVersion,
          p_config_version: Number(input.configVersion),
          p_configuration: input.configuration
        }
      );
      if (input.signal.aborted) throw input.signal.reason ?? new Error("Invocation aborted");
      if (response.error) throw new Error("Growth configuration unavailable");
      assertIdentity(response.data, input);
      return response.data;
    }
  };
}

export function createOfficialAssemblyGrowthHandlers(
  adapter: OfficialAssemblyGrowthConfigurationAdapter
): readonly ProvisioningSiteCommandHandler<{
  configuration: typeof OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION;
}>[] {
  return Object.freeze(MODULES.map((module) => {
    const identity = Object.freeze({
      moduleId: module.moduleId,
      moduleVersion: module.moduleVersion,
      configVersion: CONFIG_VERSION,
      configuration: OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION
    });
    return Object.freeze({
      type: module.type,
      version: 1,
      idempotency: "commandId" as const,
      validate: exactConfigurationPayload,
      async execute(input: {
        commandId: string;
        idempotencyKey: string;
        payload: { configuration: typeof OFFICIAL_ASSEMBLY_GROWTH_CONFIGURATION };
        signal: AbortSignal;
        lease: SiteCommandLeaseContext;
      }) {
        const { commandId, payload, signal, lease } = input;
        const result = await adapter.applyConfiguration({
          commandId,
          ...identity,
          configuration: payload.configuration,
          signal,
          lease
        });
        assertIdentity(result, identity);
        return {
          resultCode: "GROWTH_CONFIGURATION_CONFIGURED",
          evidence: {
            codes: ["GROWTH_CONFIGURATION_CONFIGURED"],
            metrics: {},
            flags: {},
            digests: { configuration: configurationDigest(identity) }
          }
        };
      }
    });
  }));
}
