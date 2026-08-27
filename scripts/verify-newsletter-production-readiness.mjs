import { readNewsletterConfiguration, readNewsletterProviderInventoryConfiguration } from "../lib/newsletter/config.ts";
import {
  evaluateNewsletterProviderInventory,
  resolveNewsletterInventoryActivationStage
} from "../lib/newsletter/provider-inventory.ts";
import { createNewsletterProviderInventoryEvidenceRepository } from "../lib/newsletter/provider-inventory-repository.ts";
import {
  collectNewsletterProviderInventory,
  createProductionNewsletterInventoryReader,
  NewsletterProviderInventoryReadError
} from "../lib/newsletter/resend/inventory-adapter.ts";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../lib/supabase/admin.ts";

function stop(code, details = {}) {
  process.stderr.write(`${JSON.stringify({ newsletterPreflight: "blocked", code, ...details })}\n`);
  process.exitCode = 1;
}

let preflightStep = "structural_configuration";

async function main() {
  preflightStep = "structural_configuration";
  const structural = readNewsletterConfiguration();
  if (structural.status === "disabled") {
    process.stdout.write(`${JSON.stringify({ newsletterPreflight: "disabled" })}\n`);
    return;
  }
  if (structural.status !== "ready") {
    stop(structural.code);
    return;
  }

  preflightStep = "inventory_configuration";
  const inventoryConfiguration = readNewsletterProviderInventoryConfiguration();
  if (inventoryConfiguration.status !== "ready") {
    stop(inventoryConfiguration.code);
    return;
  }
  preflightStep = "database_client";
  const client = getBuilderAdminClient();
  if (!client) {
    stop("database_unavailable");
    return;
  }
  preflightStep = "site_resolution";
  const siteId = await resolveBuilderSiteId(client);
  if (!siteId) {
    stop("site_unavailable");
    return;
  }

  const repository = createNewsletterProviderInventoryEvidenceRepository(client, siteId);
  preflightStep = "provider_inventory";
  const snapshot = await collectNewsletterProviderInventory(
    createProductionNewsletterInventoryReader({
      managementApiKey: process.env.RESEND_MANAGEMENT_API_KEY,
      sendApiKey: process.env.RESEND_SEND_API_KEY,
      segmentId: inventoryConfiguration.segmentId
    })
  );
  preflightStep = "evidence_read";
  const evidence = await repository.read();
  preflightStep = "initial_evaluation";
  const initial = evaluateNewsletterProviderInventory({
    stage: "initial",
    configuration: inventoryConfiguration,
    snapshot,
    evidence
  });
  preflightStep = "activation_digest";
  const activeDigest = await repository.activeActivationDigest();
  const stage = resolveNewsletterInventoryActivationStage(
    activeDigest,
    initial.resourceIdentityDigest
  );
  preflightStep = "steady_evaluation";
  const result = stage === "initial"
    ? initial
    : evaluateNewsletterProviderInventory({
        stage: "steady",
        configuration: inventoryConfiguration,
        snapshot,
        evidence
      });

  if (result.state !== "ready") {
    process.stderr.write(`${JSON.stringify({
      newsletterPreflight: "blocked",
      mode: result.mode,
      categories: result.categories.map(({ category, status, code, count }) => ({
        category,
        status,
        code,
        count
      }))
    })}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${JSON.stringify({
    newsletterPreflight: "ready",
    mode: result.mode,
    counts: result.counts
  })}\n`);
}

main().catch((error) => {
  if (error instanceof NewsletterProviderInventoryReadError) {
    stop(error.code, { step: preflightStep, stage: error.stage });
    return;
  }
  stop("unsupported_inventory", { step: preflightStep });
});
