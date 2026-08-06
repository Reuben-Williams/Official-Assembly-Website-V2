import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const EXPECTED_PRODUCTION_BASELINE = Object.freeze([
  ["20260805205410_posts_foundation.sql", "c421f2caaa80a82799a4e0b66c7ef3688e6058d123cf05e86f5ff166f7628fc7"],
  ["20260805205423_posts_operations.sql", "32b01688695d5402832fc9507a7ae47b86c4ac4fcf3e36ded604a6d3be2ed551"],
  ["20260805205425_growth_capabilities.sql", "072964797a2613c4d2709a6dbe2933f4e92dbae058232e9e69f6e17421df03b2"],
  ["20260805205427_provisioning_receipts.sql", "6932fa8664bd920443a9d817a61dade38f67a531173ff652b676deae7a05e90a"],
  ["20260805205428_foundation_acceptance_hardening.sql", "0039c82b9b9d62843c891c209e87b539d340c5f43b3e2ac3ddb78e0058ccf9e7"],
  ["20260805205430_phase2a_base_intake.sql", "7b6f6fede66b219564044795135860df6517db69c9ae0b60c609c93205e3e872"],
  ["20260805205432_phase2a_growth_records.sql", "b2b5c0f24ade6b2f767f1c69688d0ede185c3ab0f732c9e01701476bad42fd9a"],
  ["20260805205435_phase2a_growth_authorization.sql", "0d635a9b557b5ee96ab45006e16acff12e12d680ca023fef15b79a1d1ade097d"],
  ["20260805205439_phase2b_ingestion_services.sql", "220a4972fb3a5d365461d999d6a60fcde3cdc5966bf3c34a758ccaf37da911ec"],
  ["20260805205443_phase2c_read_projections.sql", "0be82814d0dd41846eb416afc98301a81793fba17723acac994ca221d56d67de"],
  ["20260805205445_phase2c_residual_operations.sql", "a21ebf6042ea55931a207bde303643e22c65f1088635f3327ae772de28f68e4f"],
  ["20260805205447_phase2c_saved_view_virtual_fields.sql", "7608bf433f7b965a39b862030f22a2ebee41f20fda9cae4aeba3e9b2f1638e07"],
  ["20260805205449_installation_worker_lease.sql", "fcbcaaa8c4fc002109fa0a00aa0985156568c3e18cc82be3a0aa0afb73ea9c78"],
  ["20260805205450_restore_editor_content_storage.sql", "3486cebc9e40afbdbf685e86d71a8f2669ab938425db4718dc3fa062ded9289b"],
  ["20260805205451_growth_configuration_commands.sql", "afa3edb348d8b99f12bed36451668a39e2aad80b405c056396799850b651ff59"],
  ["20260805205454_reusable_forms_management.sql", "e75001ef9639af6f9c4e02a85825b54a92a76d61c3ff6df7b8f935fb5fc49388"],
  ["20260805205457_reusable_forms_privacy_lifecycle.sql", "1e08188f5bedb927c71b29d5358241aa5e9f8dafbd2b2322e8517bf9bdc2d9f3"],
  ["20260805205458_strict_public_form_ingestion.sql", "8e937c79c98784dc4afe385cf30664445aa953e11c85b7f303a514b4c26ce90e"],
  ["20260805225417_official_assembly_live_growth_configuration.sql", "1013faf6bc7bf1c671f9b26a26a4bc21a8522e88d991f1173676e897fd2b9226"],
  ["20260806025502_private_media_upload_pipeline.sql", "3319519eb22e84c00a20852e06891aad10ec0698ac2f7d4273d48d60abc9bc1c"]
]);

export const EXPECTED_PENDING_MIGRATIONS = Object.freeze([
  ["20260806172042_official_assembly_live_newsletter.sql", "d80118b35e65aea5da11019c0515a644b834c17e4884fe92da99965a58e70dc0"],
  ["20260806175033_newsletter_worker_evidence.sql", "60ee5ef58fcd0a5c082a8b5f5e50e7aeab1630ba76857eae9a5db120b83c1cc5"],
  ["20260806180042_newsletter_atomic_webhook_classification.sql", "a17c322a2804c8209a4d8ef4952746388883dbdf5e8bc2cc0c5236fdf270ed12"]
]);

export async function verifyProductionMigrationLineage(repositoryRoot) {
  const migrationsDirectory = path.join(repositoryRoot, "supabase", "migrations");
  const expected = [...EXPECTED_PRODUCTION_BASELINE, ...EXPECTED_PENDING_MIGRATIONS];
  const expectedFilenames = expected.map(([filename]) => filename);
  const actualFilenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  if (JSON.stringify(actualFilenames) !== JSON.stringify(expectedFilenames)) {
    throw new Error(
      `Deployable migration lineage mismatch; expected ${expectedFilenames.join(", ")}; received ${actualFilenames.join(", ")}`
    );
  }

  for (const [filename, expectedChecksum] of expected) {
    const contents = await readFile(path.join(migrationsDirectory, filename));
    const actualChecksum = createHash("sha256").update(contents).digest("hex");
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Production migration checksum mismatch: ${filename}; expected ${expectedChecksum}; received ${actualChecksum}`
      );
    }
  }

  return {
    baseline: EXPECTED_PRODUCTION_BASELINE.length,
    pending: EXPECTED_PENDING_MIGRATIONS.length,
    valid: true
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  const repositoryRoot = path.resolve(path.dirname(process.argv[1]), "..");
  verifyProductionMigrationLineage(repositoryRoot)
    .then(({ baseline, pending }) => {
      process.stdout.write(
        `Verified ${baseline} production migrations and ${pending} approved pending migrations.\n`
      );
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Migration verification failed."}\n`);
      process.exitCode = 1;
    });
}
