import { allowedBuilderOrigins, BUILDER_SITE_KEY } from "../../../../lib/builder/authorization";
import { createStaffSignInHandler } from "../../../../lib/builder/staff-sign-in";
import { getBuilderAdminClient } from "../../../../lib/supabase/admin";
import { createRequestSupabaseClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  const canonical = process.env.NEXT_PUBLIC_SITE_URL;
  if (!canonical) return Response.json({ status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  return createStaffSignInHandler({
    origins: allowedBuilderOrigins(new URL(request.url).origin), canonicalOrigin: new URL(canonical).origin,
    reserve: async (email) => {
      const admin = getBuilderAdminClient(); if (!admin) throw new Error("unavailable");
      const result = await admin.rpc("builder_staff_auth_reserve", { p_site_key: BUILDER_SITE_KEY, p_email: email, p_request_id: crypto.randomUUID() });
      if (result.error) throw new Error("unavailable");
      const row = result.data as { id?: string; reserved_at?: string } | null;
      return row?.id && row.reserved_at ? { id: row.id, reservedAt: row.reserved_at } : null;
    },
    finalize: async (id, state, code) => {
      const admin = getBuilderAdminClient(); if (!admin) throw new Error("unavailable");
      const result = await admin.rpc("builder_staff_auth_finalize", { p_request_id: id, p_state: state, p_code: code });
      if (result.error || typeof result.data !== "string") throw new Error("unavailable");
      return result.data;
    },
    send: async (input) => {
      const client = await createRequestSupabaseClient(); if (!client) throw new Error("unavailable");
      return client.auth.signInWithOtp(input);
    }
  })(request);
}
