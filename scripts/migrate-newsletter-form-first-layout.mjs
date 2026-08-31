import site from "../builder.config.ts";
import {
  createBuilderContentCommand,
  createSiteKeyResolvingAdapter,
  createSupabaseContentCommandExecutor,
} from "../lib/builder/repositories.ts";
import { planNewsletterLayoutTransition } from "../lib/builder/newsletter-layout.ts";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../lib/supabase/admin.ts";

const PRODUCTION_SUPABASE_URL = "https://rriebibkxymeqhafssvw.supabase.co";
const NEWSLETTER_PATH = "/newsletter";

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function stop(code) {
  output({ newsletterLayoutMigration: "blocked", code });
  process.exitCode = 1;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const client = getBuilderAdminClient();
  if (!client) return stop("database_unavailable");
  if (apply && process.env.NEXT_PUBLIC_SUPABASE_URL !== PRODUCTION_SUPABASE_URL) {
    return stop("production_database_required");
  }

  const siteId = await resolveBuilderSiteId(client);
  if (!siteId) return stop("site_unavailable");
  const owner = await client
    .from("builder_site_members")
    .select("user_id")
    .eq("site_id", siteId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (owner.error || !owner.data?.user_id) return stop("owner_unavailable");

  const adapter = createSiteKeyResolvingAdapter({ client, siteKey: site.siteId });
  const [draft, published] = await Promise.all([
    adapter.getDraftContent(site.siteId, NEWSLETTER_PATH),
    adapter.getPublishedContent(site.siteId, NEWSLETTER_PATH),
  ]);
  const plan = planNewsletterLayoutTransition({ draft, published });
  const evidence = {
    newsletterLayoutMigration: plan.status,
    apply,
    expectedDraftVersionId: plan.expectedDraftVersionId,
    expectedPublishedVersionId: plan.expectedPublishedVersionId,
    retiredRegionIds: plan.retiredRegionIds,
    nextSectionOrder: plan.values["newsletter.sections"],
  };

  if (plan.status === "blocked_pending_draft") {
    output(evidence);
    process.exitCode = 1;
    return;
  }
  if (plan.status === "already_current" || !apply) {
    output(evidence);
    return;
  }

  const actorId = String(owner.data.user_id);
  const executor = createSupabaseContentCommandExecutor(client);
  const saved = await executor.execute(site.siteId, await createBuilderContentCommand({
    siteId: site.siteId,
    actorId,
    operation: "save",
    scopes: [{
      scope: { kind: "page", path: NEWSLETTER_PATH },
      expectedDraftVersionId: plan.expectedDraftVersionId,
      expectedPublishedVersionId: plan.expectedPublishedVersionId,
      values: plan.values,
    }],
  }));
  const savedScope = saved.scopes.find((scope) => scope.path === NEWSLETTER_PATH);
  if (!savedScope?.resultVersionId) return stop("draft_transition_failed");

  const publishedResult = await executor.execute(site.siteId, await createBuilderContentCommand({
    siteId: site.siteId,
    actorId,
    operation: "publish",
    scopes: [{
      scope: { kind: "page", path: NEWSLETTER_PATH },
      expectedDraftVersionId: savedScope.resultVersionId,
      expectedPublishedVersionId: plan.expectedPublishedVersionId,
      values: plan.values,
    }],
  }));
  output({
    ...evidence,
    newsletterLayoutMigration: "published",
    resultVersionId: publishedResult.scopes.find((scope) => scope.path === NEWSLETTER_PATH)?.resultVersionId ?? null,
  });
}

main().catch(() => stop("migration_failed"));
