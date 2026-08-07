import "server-only";

import {
  normalizeRegionDefinitions,
  type BuilderContentAdapter,
  type EditableValue,
} from "@reuben-williams/core";
import { cache } from "react";

import site from "../../builder.config";
import { getBuilderAdminClient } from "../supabase/admin";
import { createSiteKeyResolvingAdapter } from "./repositories";

const GLOBAL_CONTENT_PATH = "/__builder/global";

export type BuilderServerContent = Readonly<{
  regions: Readonly<Record<string, EditableValue>>;
}>;

type LoaderDependencies = Readonly<{
  adapter?: BuilderContentAdapter;
}>;

export class BuilderPublishedContentUnavailableError extends Error {
  constructor(
    public readonly pagePath: string,
    options?: ErrorOptions,
  ) {
    super("Published website content is temporarily unavailable.", options);
    this.name = "BuilderPublishedContentUnavailableError";
  }
}

function registeredKinds(pagePath: string) {
  const page = site.pages.find((candidate) => candidate.path === pagePath);
  if (!page) throw new TypeError(`The page path "${pagePath}" is not registered.`);
  return new Map([
    ...normalizeRegionDefinitions(site.globalRegions ?? []),
    ...normalizeRegionDefinitions(page.regions),
  ].map((region) => [region.id, region.kind] as const));
}

function globalKinds() {
  return new Map(normalizeRegionDefinitions(site.globalRegions ?? [])
    .map((region) => [region.id, region.kind] as const));
}

function registeredValues(
  kinds: ReadonlyMap<string, string>,
  stored: Readonly<Record<string, EditableValue>>,
) {
  const regions: Record<string, EditableValue> = {};
  for (const [regionId, kind] of kinds) {
    const value = stored[regionId];
    if (value?.type === kind) regions[regionId] = value;
  }
  return regions;
}

function defaultAdapter() {
  const client = getBuilderAdminClient();
  if (!client) throw new Error("Published-content credentials are unavailable.");
  return createSiteKeyResolvingAdapter({ client, siteKey: site.siteId });
}

const getDefaultAdapter = cache(defaultAdapter);

const readDefaultPublishedScope = cache(async (path: string) => {
  const adapter = getDefaultAdapter();
  return adapter.getPublishedContent(site.siteId, path);
});

function readPublishedScope(path: string, dependencies: LoaderDependencies) {
  return dependencies.adapter
    ? dependencies.adapter.getPublishedContent(site.siteId, path)
    : readDefaultPublishedScope(path);
}

export async function loadBuilderServerContent(
  pagePath: string,
  dependencies: LoaderDependencies = {},
): Promise<BuilderServerContent> {
  const kinds = registeredKinds(pagePath);
  try {
    const [global, page] = await Promise.all([
      readPublishedScope(GLOBAL_CONTENT_PATH, dependencies),
      readPublishedScope(pagePath, dependencies),
    ]);
    const stored = { ...global.regions, ...page.regions };
    return { regions: registeredValues(kinds, stored) };
  } catch (cause) {
    if (cause instanceof BuilderPublishedContentUnavailableError) throw cause;
    throw new BuilderPublishedContentUnavailableError(pagePath, {
      cause: cause instanceof Error ? cause : undefined,
    });
  }
}

export async function loadBuilderGlobalContent(
  dependencies: LoaderDependencies = {},
): Promise<BuilderServerContent> {
  try {
    const global = await readPublishedScope(GLOBAL_CONTENT_PATH, dependencies);
    return { regions: registeredValues(globalKinds(), global.regions) };
  } catch (cause) {
    throw new BuilderPublishedContentUnavailableError(GLOBAL_CONTENT_PATH, {
      cause: cause instanceof Error ? cause : undefined,
    });
  }
}

export function builderText(
  content: BuilderServerContent,
  regionId: string,
  fallback: string,
) {
  const value = content.regions[regionId];
  return value?.type === "text" ? value.value : fallback;
}

export function builderLink(
  content: BuilderServerContent,
  regionId: string,
  fallback: Readonly<{ href: string; label: string }>,
) {
  const value = content.regions[regionId];
  return value?.type === "link"
    ? { href: value.href, label: value.label, disabled: value.disabled === true }
    : { ...fallback, disabled: false };
}

export function builderImage(
  content: BuilderServerContent,
  regionId: string,
  fallback: Readonly<{ src: string; alt: string }>,
) {
  const value = content.regions[regionId];
  return value?.type === "image"
    ? { src: value.src, alt: value.alt || fallback.alt }
    : fallback;
}

export function builderSectionIds(
  content: BuilderServerContent,
  regionId: string,
  fallback: readonly string[],
) {
  const value = content.regions[regionId];
  return value?.type === "sections" ? value.value : [...fallback];
}
