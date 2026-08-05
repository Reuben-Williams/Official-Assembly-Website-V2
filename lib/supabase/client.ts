"use client";

import { createBuilderBrowserClient } from "@reuben-williams/next/auth";

let browserClient: ReturnType<typeof createBuilderBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return null;
  browserClient ??= createBuilderBrowserClient({ url, publishableKey });
  return browserClient;
}
