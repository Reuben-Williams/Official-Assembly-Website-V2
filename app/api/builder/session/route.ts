import { issuePreviewSession, requireBuilderMember } from "@reuben-williams/next/auth";
import { NextResponse } from "next/server";

import {
  BUILDER_SITE_KEY,
  allowedBuilderOrigins,
  assertRequestOrigin,
  lookupBuilderMembership
} from "../../../../lib/builder/authorization";
import { builderSessionCookies } from "../../../../lib/builder/session-cookies";
import { getBuilderAdminClient } from "../../../../lib/supabase/admin";
import { createRequestSupabaseClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "cache-control": "no-store" };

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: noStore });
}

async function membershipForRequest() {
  const client = await createRequestSupabaseClient();
  const admin = getBuilderAdminClient();
  if (!client || !admin) return null;
  try {
    const membership = await requireBuilderMember({
      client,
      siteKey: BUILDER_SITE_KEY,
      lookup: (siteKey, userId) => lookupBuilderMembership(admin, siteKey, userId)
    });
    return { client, admin, membership };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const secret = process.env.BUILDER_PREVIEW_SECRET;
  if (!secret || secret.length < 32) {
    return error(503, "EDITOR_NOT_CONFIGURED", "The editor session service is not configured.");
  }
  const origin = new URL(request.url).origin;
  try {
    assertRequestOrigin(request, allowedBuilderOrigins(origin));
  } catch {
    return error(403, "ORIGIN_REJECTED", "The request origin is not allowed.");
  }
  const resolved = await membershipForRequest();
  if (!resolved) return error(401, "AUTH_REQUIRED", "A verified editor account is required.");

  const csrfToken = crypto.randomUUID().replaceAll("-", "");
  const token = await issuePreviewSession({
    siteKey: BUILDER_SITE_KEY,
    userId: resolved.membership.userId,
    generation: resolved.membership.previewGeneration,
    allowedOrigins: allowedBuilderOrigins(origin),
    csrfToken,
    secret,
    ttlSeconds: 28_800
  });
  const response = NextResponse.json(
    { role: resolved.membership.role, siteKey: BUILDER_SITE_KEY },
    { headers: noStore }
  );
  const cookieOptions = {
    maxAge: 28_800,
    path: "/",
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production"
  };
  response.cookies.set(builderSessionCookies.editor, token, { ...cookieOptions, httpOnly: true });
  response.cookies.set(builderSessionCookies.csrf, csrfToken, { ...cookieOptions, httpOnly: false });
  return response;
}

export async function DELETE(request: Request) {
  const origin = new URL(request.url).origin;
  try {
    assertRequestOrigin(request, allowedBuilderOrigins(origin));
  } catch {
    return error(403, "ORIGIN_REJECTED", "The request origin is not allowed.");
  }
  const resolved = await membershipForRequest();
  if (!resolved) return error(401, "AUTH_REQUIRED", "A verified editor account is required.");
  const { error: revokeError } = await resolved.client.rpc("builder_revoke_preview_sessions", {
    p_site_key: BUILDER_SITE_KEY
  });
  if (revokeError) return error(503, "REVOCATION_UNAVAILABLE", "The editor session could not be revoked.");
  await resolved.client.auth.signOut();
  const response = new NextResponse(null, { status: 204, headers: noStore });
  response.cookies.set(builderSessionCookies.editor, "", { expires: new Date(0), path: "/" });
  response.cookies.set(builderSessionCookies.csrf, "", { expires: new Date(0), path: "/" });
  return response;
}
