import "server-only";

import {
  createSupabaseSiteInstallationRuntime,
  parseSiteRuntimeMarker
} from "@reuben-williams/next/control-plane";
import { parseInstallationManifest } from "@reuben-williams/entitlements/trust";

import installationManifest from "../../.builder/installation-manifest.json";
import runtimeMarker from "../../.builder/site-runtime.json";
import { getBuilderAdminClient } from "../supabase/admin";
import {
  createOfficialAssemblyGrowthHandlers,
  createSupabaseOfficialAssemblyGrowthConfigurationAdapter
} from "./growth-command-handlers";
import { createOfficialAssemblyHealthSource } from "./health-source";

export function createOfficialAssemblyInstallationRuntime() {
  const client = getBuilderAdminClient();
  if (!client) throw new Error("Installation runtime unavailable");
  const handlers = createOfficialAssemblyGrowthHandlers(
    createSupabaseOfficialAssemblyGrowthConfigurationAdapter(client)
  );
  const marker = parseSiteRuntimeMarker(runtimeMarker);
  const manifest = parseInstallationManifest(installationManifest);
  return createSupabaseSiteInstallationRuntime({
    env: process.env,
    marker,
    installationManifest: manifest,
    handlers,
    healthSource: createOfficialAssemblyHealthSource(client, marker.siteDataPlaneSiteId),
    supabaseClient: client
  });
}
