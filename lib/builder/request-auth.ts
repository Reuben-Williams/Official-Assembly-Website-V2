import {
  requireBuilderMember,
  verifyPreviewSession
} from "@reuben-williams/next/auth";

import {
  BUILDER_SITE_KEY,
  lookupBuilderMembership,
  type ActiveBuilderIdentity
} from "./authorization";
import { getBuilderAdminClient } from "../supabase/admin";
import { createRequestSupabaseClient } from "../supabase/server";
import { builderSessionCookies } from "./session-cookies";

const identityCache = new WeakMap<Request, Promise<ActiveBuilderIdentity | null>>();

function requestCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [candidate, ...rest] = part.trim().split("=");
    if (candidate === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function resolveIdentity(request: Request): Promise<ActiveBuilderIdentity | null> {
  const client = await createRequestSupabaseClient();
  const admin = getBuilderAdminClient();
  const secret = process.env.BUILDER_PREVIEW_SECRET;
  const token = requestCookie(request, builderSessionCookies.editor);
  if (!client || !admin || !secret || secret.length < 32 || !token) return null;

  try {
    const membership = await requireBuilderMember({
      client,
      siteKey: BUILDER_SITE_KEY,
      lookup: (siteKey, userId) => lookupBuilderMembership(admin, siteKey, userId)
    });
    const session = await verifyPreviewSession(token, {
      secret,
      siteKey: BUILDER_SITE_KEY,
      userId: membership.userId,
      generation: membership.previewGeneration,
      origin: new URL(request.url).origin
    });
    return {
      userId: membership.userId,
      role: membership.role,
      siteKey: membership.siteKey,
      siteId: membership.siteId,
      sessionGeneration: membership.previewGeneration,
      tokenGeneration: session.generation,
      csrfToken: session.csrfToken
    };
  } catch {
    return null;
  }
}

export function authenticateBuilderRequest(request: Request) {
  let cached = identityCache.get(request);
  if (!cached) {
    cached = resolveIdentity(request);
    identityCache.set(request, cached);
  }
  return cached;
}
