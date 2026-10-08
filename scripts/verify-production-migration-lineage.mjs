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
  ["20260806180042_newsletter_atomic_webhook_classification.sql", "a17c322a2804c8209a4d8ef4952746388883dbdf5e8bc2cc0c5236fdf270ed12"],
  ["20260807032126_official_assembly_editor_content_publishing_v2.sql", "7877e78aa73f9fb39ae193c17950a78b34ea50500aadd83430414c3c9fd17563"],
  ["20260807040500_post_stage_validation_and_slug_reservations.sql", "35193343c34e1d50b6762eadaaa3b37b804d0a389d1a54cb27c79ffcab1be181"],
  ["20260807050000_managed_media_revision_recovery.sql", "6dc437c0b7e149c681965161202472b264d637bc1649e7f2655e1878c537f455"],
  ["20260807060000_initial_content_recovery_generation.sql", "af04e83846b9111b7ca6fc44cb29e35877e3c9781cd37a210afd12821ec332e6"],
  ["20260807140000_newsletter_durable_readiness.sql", "8ac383f128c4d982592b9abc7e2bcebca784d97453536ab3d34156b2de5f8854"],
  ["20260807191500_publish_approved_newsletter_form.sql", "01f438f37ad6f79ff774bf99455723c58a90444a1b291ccb6af5f41829594903"],
  ["20260808010000_newsletter_history_reconciliation.sql", "8273b31949218bb62ccee6aa6fb51623c33c08528dc3287d76c52ffb6756aead"],
  ["20260808020000_newsletter_history_reconciliation_v2.sql", "167f5106105b8d9b8a32caa775c1a46b1bb929c64a8671f65c6d10580e677904"],
  ["20260808092616_versioned_site_alerts.sql", "9b9a8492c9b990bd4ce65708f46408ea2318836527064b24506f0c8949e2bad6"],
  ["20260811222019_alert_scroll_mode.sql", "04cde38701f34ee2739772565bcc559ae8e7cb26345520a5e17d8b138aad79bd"],
  ["20260811235246_newsletter_owner_login_evidence.sql", "cc24084f1e73e0be7f3c3f3b2d87ddef4565c996498a7777acd68e024989fcd1"],
  ["20260812001718_newsletter_owner_login_immutability.sql", "1343f4e862d26217c7b0ee23eb5f155526581b4060f480afd51f87cc4188daef"],
  ["20260812035711_complete_bilingual_publishing.sql", "073b44f0a19f6d4370aece008a2c189c40c076e3b2b50f9a6b63441aaf58a01a"],
  ["20260812221730_editor_login_completion_proofs.sql", "fabfd42184c9651fcff9dd9efe8e21f74072ebeed085ea1906942dbfb86731f3"],
  ["20260902033000_site_calendar_publishing.sql", "ea3f81bd4f43e6240d9cb9dad79fe5c27a366d2a4835b81d4b33d0d74b461b02"],
  ["20260914232545_newsletter_reconciliation_epoch_restart.sql", "273c0199cb79da4bacba6a8b6092b7bf96526eb31c90c7af598b3f65106f5106"],
  ["20261002025302_carousel_studio.sql", "6cf403a43f8c48c584b21890c41b5083df717d2eebed1dcb8e13dccdff33f599"],
  ["20261002035726_fix_media_claim_required_description.sql", "fbf52b37451956ab8fb1b392a017e238f1ede80c3d7bf277f48cb37448351316"],
  ["20261002041414_register_events_recovery_route.sql", "f1d5a89afe470d493a20d51be62a3b138d6041ea77c0a81cc22b13a02544deb1"],
  ["20261006034057_carousel_caption_visibility.sql", "56c86baa3cc19ce75b063a8df91c02c74be88cb3193f7f065b0c09f48e9f304a"],
  ["20261006044819_staff_auth_delivery_evidence.sql", "90701f68d20ab0d2ab01715a5a42ec311faf82d96cfddd9633b748846c6a714d"],
  ["20261006045047_calendar_optional_spanish.sql", "41908e047e9ad3dc6b1e6cfbabf25e82c674127d8b2cd1bc886f09807110acd1"],
  ["20261007233605_page_media_publish_reliability.sql", "5664075a633a5d23f194e3c9877969a818c0fbcafaa7f38bfa36eb155bcba1cd"],
  ["20261008021107_website_team_notices.sql", "7c90dde508e290e2cd106ede0f5a9202d8a6b5769fb190650c1f49beb6eb4259"],
  ["20261008021727_press_releases_route_reservation.sql", "f8af31f115da77b92604c184106da3cb6b57cb7754cb75cf1ad223a8f24f0385"]
]);

function checksumCandidates(contents) {
  const text = contents.toString("utf8");
  return new Set([
    contents,
    Buffer.from(text.replaceAll("\r\n", "\n"), "utf8"),
    Buffer.from(text.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"), "utf8"),
  ].map((value) => createHash("sha256").update(value).digest("hex")));
}

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
    if (!checksumCandidates(contents).has(expectedChecksum)) {
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
