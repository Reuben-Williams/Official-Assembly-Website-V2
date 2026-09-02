import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { BUILDER_SITE_KEY } from "../builder/authorization";
import { listNormalizedMediaAssets } from "../builder/repositories";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../supabase/admin";
import { loadPublicCalendar, type CalendarRepository, type PublicCalendarLoad } from "./repository";
import { createSupabaseCalendarRepository } from "./supabase-repository";

type PublicCalendarDependencies = Readonly<{
  client?: SupabaseClient | null;
  repository?: CalendarRepository;
}>;

export async function loadOfficialAssemblyPublicCalendar(
  input: { limit: number; evaluatedAt?: string } = { limit: 100 },
  dependencies: PublicCalendarDependencies = {},
): Promise<PublicCalendarLoad> {
  const client = dependencies.client === undefined ? getBuilderAdminClient() : dependencies.client;
  const repository = dependencies.repository ?? (client ? createSupabaseCalendarRepository(client) : null);
  if (!repository) return { status: "unavailable" };

  const calendar = await loadPublicCalendar(repository, {
    siteKey: BUILDER_SITE_KEY,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
    limit: input.limit,
  });
  if (calendar.status !== "ready" || calendar.events.length === 0 || !client) return calendar;

  const requestedMedia = new Set(calendar.events.flatMap((event) => event.mediaAssetId ?? []));
  if (requestedMedia.size === 0) return calendar;

  try {
    const siteId = await resolveBuilderSiteId(client);
    if (!siteId) return calendar;
    const media = await listNormalizedMediaAssets(client, siteId);
    const urls = new Map(media.map((asset) => [asset.id, asset.url]));
    return {
      status: "ready",
      events: calendar.events.map((event) => {
        const mediaUrl = event.mediaAssetId ? urls.get(event.mediaAssetId) : undefined;
        return mediaUrl ? { ...event, mediaUrl } : event;
      }),
    };
  } catch {
    // The image is optional. A media read failure must not hide otherwise valid public events.
    return calendar;
  }
}
