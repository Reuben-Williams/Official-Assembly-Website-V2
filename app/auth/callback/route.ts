import { NextResponse } from "next/server";

import {
  BUILDER_SITE_KEY,
  isSafeReturnPath,
  lookupBuilderMembership
} from "../../../lib/builder/authorization";
import {
  editorLoginCompletionCookie,
  editorLoginCompletionTtlSeconds,
  issueEditorLoginCompletion
} from "../../../lib/builder/login-completion";
import { recordNewsletterOwnerLoginOccurrence } from "../../../lib/newsletter/owner-login-occurrence";
import { getBuilderAdminClient } from "../../../lib/supabase/admin";
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
  const userId = data.user?.id ?? "";
  const admin = getBuilderAdminClient();
  const membership = admin && userId
    ? await lookupBuilderMembership(admin, BUILDER_SITE_KEY, userId)
    : null;
  if (!admin || !membership) return NextResponse.redirect(new URL("/admin/login", url.origin));
  let loginCompletion: string;
  try {
    loginCompletion = await issueEditorLoginCompletion({
      client: admin,
      userId,
      sessionGeneration: membership.previewGeneration
    });
  } catch {
    return NextResponse.redirect(new URL("/admin/login", url.origin));
  }
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
  const response = NextResponse.redirect(finish);
  response.cookies.set(editorLoginCompletionCookie, loginCompletion, {
    httpOnly: true,
    maxAge: editorLoginCompletionTtlSeconds,
    path: "/api/builder/session",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production"
  });
  return response;
}
