import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

const REQUIRED_KEYS = [
  "API_URL",
  "DB_URL",
  "PUBLISHABLE_KEY",
  "SERVICE_ROLE_KEY",
];
const TEST_PAGE_PATHS = ["/__builder/global", "/newsletter"];

export function parseSupabaseEnvironment(output) {
  const environment = {};
  for (const line of output.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    const encoded = line.slice(separator + 1);
    try {
      environment[key] = JSON.parse(encoded);
    } catch {
      environment[key] = encoded;
    }
  }
  return environment;
}

export function assertLocalSupabaseEnvironment(environment) {
  for (const key of REQUIRED_KEYS) {
    if (!environment[key]) {
      throw new Error(`The local Supabase environment is missing ${key}.`);
    }
  }

  const api = new URL(environment.API_URL);
  const database = new URL(environment.DB_URL);
  const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!loopback.has(api.hostname) || !loopback.has(database.hostname)) {
    throw new Error("Browser tests may provision only the isolated local Supabase stack.");
  }
}

function localSupabaseEnvironment() {
  const output = execFileSync(process.execPath, [
    "node_modules/supabase/dist/supabase.js",
    "status",
    "-o",
    "env",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const environment = parseSupabaseEnvironment(output);
  assertLocalSupabaseEnvironment(environment);
  return environment;
}

async function seedCanonicalFallbackScopes(environment) {
  const admin = createClient(environment.API_URL, environment.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const existingSite = await admin
    .from("builder_sites")
    .select("id")
    .eq("site_key", "official-assembly-website-v2")
    .maybeSingle();
  if (existingSite.error) throw new Error(`Local site lookup failed: ${existingSite.error.message}`);

  let siteId = existingSite.data?.id;
  let createdSite = false;
  if (!siteId) {
    const insertedSite = await admin
      .from("builder_sites")
      .insert({
        site_key: "official-assembly-website-v2",
        display_name: "Official Assembly Website V2",
      })
      .select("id")
      .single();
    if (insertedSite.error) throw new Error(`Local site fixture failed: ${insertedSite.error.message}`);
    siteId = insertedSite.data.id;
    createdSite = true;
  }

  const existingPages = await admin
    .from("builder_published_pages")
    .select("path")
    .eq("site_id", siteId)
    .in("path", TEST_PAGE_PATHS);
  if (existingPages.error) throw new Error(`Local page lookup failed: ${existingPages.error.message}`);

  const existingPaths = new Set((existingPages.data ?? []).map((page) => page.path));
  const insertedPaths = TEST_PAGE_PATHS.filter((pagePath) => !existingPaths.has(pagePath));
  if (insertedPaths.length > 0) {
    const insertedPages = await admin.from("builder_published_pages").insert(
      insertedPaths.map((pagePath) => ({ site_id: siteId, path: pagePath, regions: {} })),
    );
    if (insertedPages.error) throw new Error(`Local page fixture failed: ${insertedPages.error.message}`);
  }

  return async () => {
    const cleanup = createdSite
      ? await admin.from("builder_sites").delete().eq("id", siteId)
      : insertedPaths.length > 0
        ? await admin.from("builder_published_pages").delete().eq("site_id", siteId).in("path", insertedPaths)
        : { error: null };
    if (cleanup.error) throw new Error(`Local browser-test cleanup failed: ${cleanup.error.message}`);
  };
}

async function main() {
  const environment = localSupabaseEnvironment();
  const cleanup = await seedCanonicalFallbackScopes(environment);
  let exitCode = 1;
  try {
    const result = spawnSync(
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: environment.API_URL,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: environment.PUBLISHABLE_KEY,
          SUPABASE_SERVICE_ROLE_KEY: environment.SERVICE_ROLE_KEY,
          NEWSLETTER_EMAIL_ENABLED: "false",
        },
        stdio: "inherit",
      },
    );
    exitCode = result.status ?? 1;
  } finally {
    await cleanup();
  }
  process.exitCode = exitCode;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Local browser-test setup failed.");
    process.exitCode = 1;
  });
}
