import { NextResponse } from "next/server";

import { isSafeReturnPath } from "../../../lib/builder/authorization";
import { recordNewsletterOwnerLoginOccurrence } from "../../../lib/newsletter/owner-login-occurrence";
import { createRequestSupabaseClient } from "../../../lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const requested = url.searchParams.get("next") ?? "/admin/editor";
  const next = isSafeReturnPath(requested) ? requested : "/admin/editor";
  const client = await createRequestSupabaseClient();
  if (!client) return NextResponse.redirect(new URL("/admin/login", url.origin));

  const result = tokenHash && type === "email"
    ? await client.auth.verifyOtp({ token_hash: tokenHash, type: "email" })
    : code
      ? await client.auth.exchangeCodeForSession(code)
      : null;
  if (!result) return NextResponse.redirect(new URL("/admin/login", url.origin));
  const { data, error } = result;
  if (error) return NextResponse.redirect(new URL("/admin/login", url.origin));
  if (tokenHash && type === "email") {
    const operatorId = data.user?.id ?? "";
    const authLastSignInAt = data.user?.last_sign_in_at ?? "";
    if (operatorId && authLastSignInAt) {
      try {
        await recordNewsletterOwnerLoginOccurrence({ operatorId, authLastSignInAt });
      } catch {
        console.error(JSON.stringify({
          event: "newsletter_owner_login_occurrence_unavailable",
          code: "occurrence_unavailable"
        }));
      }
    }
  }
  const finish = new URL("/admin/login", url.origin);
  finish.searchParams.set("returnTo", next);
  finish.searchParams.set("complete", "1");
  return NextResponse.redirect(finish);
}
