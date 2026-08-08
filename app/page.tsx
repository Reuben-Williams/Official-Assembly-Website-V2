import { listHomepagePublishedPosts } from "../lib/builder/published-posts";
import { loadBuilderServerContent } from "../lib/builder/server-content";
import { getBuilderAdminClient } from "../lib/supabase/admin";
import { HomePageView } from "./ui/HomePageView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const client = getBuilderAdminClient();
  const [content, posts] = await Promise.all([
    loadBuilderServerContent("/"),
    client ? listHomepagePublishedPosts(client) : Promise.resolve([]),
  ]);
  return HomePageView({ content, posts });
}
