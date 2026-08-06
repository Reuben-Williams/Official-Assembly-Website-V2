"use client";

import { BuilderDomContentBridge, BuilderPreviewBridge } from "@reuben-williams/next";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useState } from "react";

import { BUILDER_SITE_KEY } from "../lib/builder/authorization";

export function BuilderContentBridge() {
  const routePath = usePathname();
  const [resolved, setResolved] = useState<{
    routePath: string;
    contentPath: string;
  } | null>(null);

  useLayoutEffect(() => {
    const marker = document.querySelector<HTMLElement>("[data-builder-content-path]");
    const contentPath = marker?.dataset.builderContentPath === "/404" ? "/404" : routePath;
    let active = true;
    queueMicrotask(() => {
      if (active) setResolved({ routePath, contentPath });
    });
    return () => {
      active = false;
    };
  }, [routePath]);

  const current = resolved?.routePath === routePath ? resolved : null;

  return (
    <>
      {current ? (
        <BuilderDomContentBridge
          key={`${current.routePath}:${current.contentPath}`}
          mode="auto"
          pathname={current.contentPath}
        />
      ) : null}
      <BuilderPreviewBridge siteId={BUILDER_SITE_KEY} />
    </>
  );
}
