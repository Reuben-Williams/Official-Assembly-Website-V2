import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const EXPECTED_PLATFORM_MIGRATIONS = Object.freeze([
  ["migrations/20260805205410_posts_foundation.sql", "c421f2caaa80a82799a4e0b66c7ef3688e6058d123cf05e86f5ff166f7628fc7"],
  ["migrations/20260805205423_posts_operations.sql", "32b01688695d5402832fc9507a7ae47b86c4ac4fcf3e36ded604a6d3be2ed551"],
  ["migrations/20260805205425_growth_capabilities.sql", "072964797a2613c4d2709a6dbe2933f4e92dbae058232e9e69f6e17421df03b2"],
  ["migrations/20260805205427_provisioning_receipts.sql", "6932fa8664bd920443a9d817a61dade38f67a531173ff652b676deae7a05e90a"],
  ["migrations/20260805205428_foundation_acceptance_hardening.sql", "0039c82b9b9d62843c891c209e87b539d340c5f43b3e2ac3ddb78e0058ccf9e7"],
  ["migrations/20260805205430_phase2a_base_intake.sql", "7b6f6fede66b219564044795135860df6517db69c9ae0b60c609c93205e3e872"],
  ["migrations/20260805205432_phase2a_growth_records.sql", "b2b5c0f24ade6b2f767f1c69688d0ede185c3ab0f732c9e01701476bad42fd9a"],
  ["migrations/20260805205435_phase2a_growth_authorization.sql", "0d635a9b557b5ee96ab45006e16acff12e12d680ca023fef15b79a1d1ade097d"],
  ["migrations/20260805205439_phase2b_ingestion_services.sql", "220a4972fb3a5d365461d999d6a60fcde3cdc5966bf3c34a758ccaf37da911ec"],
  ["migrations/20260805205443_phase2c_read_projections.sql", "0be82814d0dd41846eb416afc98301a81793fba17723acac994ca221d56d67de"],
  ["migrations/20260805205445_phase2c_residual_operations.sql", "a21ebf6042ea55931a207bde303643e22c65f1088635f3327ae772de28f68e4f"],
  ["migrations/20260805205447_phase2c_saved_view_virtual_fields.sql", "7608bf433f7b965a39b862030f22a2ebee41f20fda9cae4aeba3e9b2f1638e07"],
  ["migrations/20260805205449_installation_worker_lease.sql", "fcbcaaa8c4fc002109fa0a00aa0985156568c3e18cc82be3a0aa0afb73ea9c78"],
  ["migrations/20260805205450_restore_editor_content_storage.sql", "3486cebc9e40afbdbf685e86d71a8f2669ab938425db4718dc3fa062ded9289b"],
  ["migrations/20260805205451_growth_configuration_commands.sql", "afa3edb348d8b99f12bed36451668a39e2aad80b405c056396799850b651ff59"],
  ["migrations/20260805205454_reusable_forms_management.sql", "e75001ef9639af6f9c4e02a85825b54a92a76d61c3ff6df7b8f935fb5fc49388"],
  ["migrations/20260805205457_reusable_forms_privacy_lifecycle.sql", "1e08188f5bedb927c71b29d5358241aa5e9f8dafbd2b2322e8517bf9bdc2d9f3"],
  ["optional-platform-migrations/20260728034823_task2_shared_operational_foundation.sql", "3aa9e2ecec5e87db9a3ba35287e1c6202f969169fd6c17b9dd55ead8e2184d4e"],
  ["optional-platform-migrations/20260728053436_task4_bookings_records.sql", "07738e66fe27a59096dadeb019e15c7d2cebcb8b32ca408abd76b648d593e59e"],
  ["optional-platform-migrations/20260728053437_task4_bookings_operations.sql", "831b9c267a0814ede83ea0d2f37c3a319bd24e7d546703ab08e354a67a2bc605"],
  ["optional-platform-migrations/20260728053438_task5_bookings_runtime_support.sql", "97e85d4f17c88504c99201a6ce7c595a42118249aaf6659776c3f7b670746522"],
  ["optional-platform-migrations/20260728204622_task9_messaging_runtime.sql", "4f7d9c5179a1055ea8cb4d5b0fac8563f8312e0c1b3ee78b3ab0a510a56a5133"],
  ["optional-platform-migrations/20260729015256_task14_campaigns_runtime.sql", "8ebea327f75802da8a7a0e952b5ba32f809e7fd670ad6f66ad7878ae10131447"],
  ["optional-platform-migrations/20260729163000_task16_automations_runtime.sql", "ec49aceedfa27dcf272cf44af4a9042d85678d41550c7ac56881f1bbf63acfc2"],
  ["optional-platform-migrations/20260729223000_task17_growth_attachment.sql", "ec6a1d4236238a1528b95e527d5644d2f95115c2092de314f66eee88476d1989"],
  ["optional-platform-migrations/20260729224500_task18_growth_configuration_expansion.sql", "1582e93be966360a3fbb5620a663e3493ce1a360ef42a90a395b5afdc450a120"],
  ["migrations/20260805205458_strict_public_form_ingestion.sql", "8e937c79c98784dc4afe385cf30664445aa953e11c85b7f303a514b4c26ce90e"],
  ["migrations/20260807032126_official_assembly_editor_content_publishing_v2.sql", "7877e78aa73f9fb39ae193c17950a78b34ea50500aadd83430414c3c9fd17563"],
  ["migrations/20260808092616_versioned_site_alerts.sql", "9b9a8492c9b990bd4ce65708f46408ea2318836527064b24506f0c8949e2bad6"],
  ["migrations/20260811222019_alert_scroll_mode.sql", "04cde38701f34ee2739772565bcc559ae8e7cb26345520a5e17d8b138aad79bd"]
]);

export async function verifyPlatformMigrationChecksums(repositoryRoot) {
  const supabaseDirectory = path.join(repositoryRoot, "supabase");

  for (const [relativePath, expectedChecksum] of EXPECTED_PLATFORM_MIGRATIONS) {
    const migrationPath = path.join(supabaseDirectory, relativePath);
    let contents;
    try {
      contents = await readFile(migrationPath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        throw new Error(`Missing approved platform migration: ${relativePath}`);
      }
      throw error;
    }

    const actualChecksum = createHash("sha256").update(contents).digest("hex");
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Approved platform migration checksum mismatch: ${relativePath}; expected ${expectedChecksum}; received ${actualChecksum}`
      );
    }
  }

  return { checked: EXPECTED_PLATFORM_MIGRATIONS.length, valid: true };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  const repositoryRoot = path.resolve(path.dirname(process.argv[1]), "..");
  verifyPlatformMigrationChecksums(repositoryRoot)
    .then(({ checked }) => {
      process.stdout.write(`Verified ${checked} approved platform migrations.\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Migration verification failed."}\n`);
      process.exitCode = 1;
    });
}
