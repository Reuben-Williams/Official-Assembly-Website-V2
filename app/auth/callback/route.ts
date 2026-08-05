import { NextResponse } from "next/server";

import { isSafeReturnPath } from "../../../lib/builder/authorization";
import { createRequestSupabaseClient } from "../../../lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next") ?? "/admin/editor";
  const next = isSafeReturnPath(requested) ? requested : "/admin/editor";
  const client = await createRequestSupabaseClient();
  if (!code || !client) return NextResponse.redirect(new URL("/admin/login", url.origin));
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/admin/login", url.origin));
  const finish = new URL("/admin/login", url.origin);
  finish.searchParams.set("returnTo", next);
  finish.searchParams.set("complete", "1");
  return NextResponse.redirect(finish);
}
