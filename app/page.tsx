import { listHomepagePublishedPosts } from "../lib/builder/published-posts";
import { loadBuilderServerContent } from "../lib/builder/server-content";
import { getBuilderAdminClient } from "../lib/supabase/admin";
import { HomePageView } from "./ui/HomePageView";
import { readPublicLocale } from "./i18n/server";
import { loadOfficialAssemblyPublicCalendar } from "../lib/calendar/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const client = getBuilderAdminClient();
  const [content, posts, locale, calendar] = await Promise.all([
    loadBuilderServerContent("/"),
    client ? listHomepagePublishedPosts(client) : Promise.resolve([]),
    readPublicLocale(),
    loadOfficialAssemblyPublicCalendar({ limit: 3 }),
  ]);
  return HomePageView({ calendar, content, posts, locale });
}
