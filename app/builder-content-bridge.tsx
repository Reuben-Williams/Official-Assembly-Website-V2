"use client";

import { BuilderDomContentBridge, BuilderPreviewBridge } from "@reuben-williams/next";

import { BUILDER_SITE_KEY } from "../lib/builder/authorization";

export function BuilderContentBridge() {
  return (
    <>
      <BuilderDomContentBridge mode="auto" />
      <BuilderPreviewBridge siteId={BUILDER_SITE_KEY} />
    </>
  );
}
