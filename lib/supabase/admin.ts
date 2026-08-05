import "server-only";

import { createBuilderSupabaseServerClient } from "@reuben-williams/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import { BUILDER_SITE_KEY } from "../builder/authorization";

export function getBuilderAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createBuilderSupabaseServerClient({ url, serviceRoleKey });
}

export async function resolveBuilderSiteId(
  client: SupabaseClient,
  siteKey = BUILDER_SITE_KEY
): Promise<string | null> {
  const { data, error } = await client
    .from("builder_sites")
    .select("id")
    .eq("site_key", siteKey)
    .maybeSingle();
  return error || !data?.id ? null : String(data.id);
}
