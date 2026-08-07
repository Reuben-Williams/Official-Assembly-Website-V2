import { randomUUID } from "node:crypto";

import { APPROVED_FORM_TEMPLATES } from "@reuben-williams/forms";

import { newsletterManagedFormConfiguration } from "../lib/newsletter/managed-form-revision.ts";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../lib/supabase/admin.ts";

const PRODUCTION_SUPABASE_URL = "https://rriebibkxymeqhafssvw.supabase.co";
const FORM_KEY = "newsletter-signup";

function stop(code) {
  process.stderr.write(`${JSON.stringify({ newsletterFormPublish: "blocked", code })}\n`);
  process.exitCode = 1;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactConfiguration(value) {
  return canonical(value) === canonical(newsletterManagedFormConfiguration);
}

async function rpc(client, request) {
  const result = await client.rpc("builder_apply_form_command_v1", { p_request: request });
  if (result.error || !result.data || typeof result.data !== "object") {
    throw new Error("form_command_failed");
  }
  return result.data;
}

async function main() {
  if (!process.argv.includes("--apply")) {
    stop("apply_flag_required");
    return;
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== PRODUCTION_SUPABASE_URL) {
    stop("production_database_required");
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
  const owner = await client.from("builder_site_members")
    .select("user_id")
    .eq("site_id", siteId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (owner.error || !owner.data?.user_id) {
    stop("owner_unavailable");
    return;
  }
  const formResult = await client.from("builder_forms")
    .select("id,record_version,draft_revision_id,published_revision_id,template_id,template_version")
    .eq("site_id", siteId)
    .eq("form_key", FORM_KEY)
    .maybeSingle();
  const form = formResult.data;
  if (formResult.error || !form || form.template_id !== "local-business.newsletter-signup"
    || form.template_version !== "1.0.0") {
    stop("managed_form_unavailable");
    return;
  }
  const revisions = await client.from("builder_form_revisions")
    .select("id,configuration")
    .eq("site_id", siteId)
    .eq("form_id", form.id)
    .in("id", [form.published_revision_id, form.draft_revision_id].filter(Boolean));
  if (revisions.error) {
    stop("managed_form_history_unavailable");
    return;
  }
  const revisionById = new Map((revisions.data ?? []).map((row) => [String(row.id), row]));
  const published = form.published_revision_id
    ? revisionById.get(String(form.published_revision_id))
    : null;
  if (published && exactConfiguration(published.configuration)) {
    process.stdout.write(`${JSON.stringify({ newsletterFormPublish: "already_current" })}\n`);
    return;
  }

  const template = APPROVED_FORM_TEMPLATES.find((candidate) =>
    candidate.id === "local-business.newsletter-signup" && candidate.version === "1.0.0"
  );
  if (!template) {
    stop("template_unavailable");
    return;
  }
  let recordVersion = Number(form.record_version);
  const draft = form.draft_revision_id ? revisionById.get(String(form.draft_revision_id)) : null;
  if (!draft || !exactConfiguration(draft.configuration)) {
    const saved = await rpc(client, {
      version: 1,
      commandId: randomUUID(),
      idempotencyKey: `newsletter-approved-save-${randomUUID()}`,
      siteId,
      actorId: String(owner.data.user_id),
      action: "save",
      expectedVersion: recordVersion,
      formId: String(form.id),
      contractDigest: template.contractDigest,
      schemaVersion: 1,
      configuration: newsletterManagedFormConfiguration
    });
    if (saved.status !== "saved" || !Number.isSafeInteger(Number(saved.recordVersion))) {
      throw new Error("form_save_failed");
    }
    recordVersion = Number(saved.recordVersion);
  }
  const publishedResult = await rpc(client, {
    version: 1,
    commandId: randomUUID(),
    idempotencyKey: `newsletter-approved-publish-${randomUUID()}`,
    siteId,
    actorId: String(owner.data.user_id),
    action: "publish",
    expectedVersion: recordVersion,
    formId: String(form.id),
    expectedContractDigest: template.contractDigest,
    expectedTemplateVersion: template.version
  });
  if (publishedResult.status !== "published") throw new Error("form_publish_failed");
  process.stdout.write(`${JSON.stringify({ newsletterFormPublish: "published" })}\n`);
}

main().catch(() => stop("publish_failed"));
