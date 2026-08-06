import "server-only";

import { timingSafeEqual } from "node:crypto";

import { BUILDER_SITE_KEY, type ActiveBuilderIdentity } from "./authorization";

const PRIVATE_MEDIA_OPERATOR_SITE_ID = "a3f57b25-df25-4d98-9ff6-a4a3f3a00a68";
const PRIVATE_MEDIA_OPERATOR_USER_ID = "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1";

export function authorizePrivateMediaOperator(request: Request): ActiveBuilderIdentity | null {
  const configured = process.env.BUILDER_MEDIA_IMPORT_TOKEN?.trim() ?? "";
  const supplied = request.headers.get("x-builder-media-import-token")?.trim() ?? "";
  if (process.env.VERCEL_ENV !== "production" ||
      !/^[0-9a-f]{64}$/.test(configured) || !/^[0-9a-f]{64}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(configured, "ascii"), Buffer.from(supplied, "ascii"))) {
    return null;
  }
  return {
    userId: PRIVATE_MEDIA_OPERATOR_USER_ID,
    role: "owner",
    siteKey: BUILDER_SITE_KEY,
    siteId: PRIVATE_MEDIA_OPERATOR_SITE_ID,
    sessionGeneration: 0,
    tokenGeneration: 0
  };
}
