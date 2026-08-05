import { cookies } from "next/headers";
import { createBuilderServerClient } from "@reuben-williams/next/auth";

export function getSupabasePublicConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}

export async function createRequestSupabaseClient() {
  const configuration = getSupabasePublicConfiguration();
  if (!configuration) return null;
  const store = await cookies();
  return createBuilderServerClient({
    ...configuration,
    cookies: {
      getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) {
            store.set(name, value, options);
          }
        } catch {
          // Server Components cannot always write refreshed cookies. The proxy handles refreshes.
        }
      }
    }
  });
}
