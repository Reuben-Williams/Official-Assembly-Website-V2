import { readNewsletterConfiguration, readNewsletterProviderInventoryConfiguration } from "../lib/newsletter/config.ts";
import {
  evaluateNewsletterProviderInventory,
  resolveNewsletterInventoryActivationStage
} from "../lib/newsletter/provider-inventory.ts";
import { createNewsletterProviderInventoryEvidenceRepository } from "../lib/newsletter/provider-inventory-repository.ts";
import {
  collectNewsletterProviderInventory,
  createProductionNewsletterInventoryReader
} from "../lib/newsletter/resend/inventory-adapter.ts";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../lib/supabase/admin.ts";

function stop(code) {
  process.stderr.write(`${JSON.stringify({ newsletterPreflight: "blocked", code })}\n`);
  process.exitCode = 1;
}

async function main() {
  const structural = readNewsletterConfiguration();
  if (structural.status === "disabled") {
    process.stdout.write(`${JSON.stringify({ newsletterPreflight: "disabled" })}\n`);
    return;
  }
  if (structural.status !== "ready") {
    stop(structural.code);
    return;
  }

  const inventoryConfiguration = readNewsletterProviderInventoryConfiguration();
  if (inventoryConfiguration.status !== "ready") {
    stop(inventoryConfiguration.code);
    return;
  }
  const client = getBuilderAdminClient();
  if (!client) {
    stop("database_unavailable");
    return;
  }
  const siteId = await resolveBuilderSiteId(client);
  if (!siteId) {
    stop("site_unavailable");
    return;
  }

  const repository = createNewsletterProviderInventoryEvidenceRepository(client, siteId);
  const snapshot = await collectNewsletterProviderInventory(
    createProductionNewsletterInventoryReader({
      managementApiKey: process.env.RESEND_MANAGEMENT_API_KEY,
      sendApiKey: process.env.RESEND_SEND_API_KEY,
      segmentId: inventoryConfiguration.segmentId
    })
  );
  const evidence = await repository.read();
  const initial = evaluateNewsletterProviderInventory({
    stage: "initial",
    configuration: inventoryConfiguration,
    snapshot,
    evidence
  });
  const activeDigest = await repository.activeActivationDigest();
  const stage = resolveNewsletterInventoryActivationStage(
    activeDigest,
    initial.resourceIdentityDigest
  );
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

main().catch(() => stop("unsupported_inventory"));
