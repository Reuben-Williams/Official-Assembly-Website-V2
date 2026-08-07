"use client";

import { BuilderPreviewBridge } from "@reuben-williams/next";

import { BUILDER_SITE_KEY } from "../lib/builder/authorization";

export function BuilderContentBridge() {
  return <BuilderPreviewBridge siteId={BUILDER_SITE_KEY} />;
}
