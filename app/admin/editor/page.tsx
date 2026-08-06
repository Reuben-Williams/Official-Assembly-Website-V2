import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authenticateBuilderRequest } from "../../../lib/builder/request-auth";
import { listPublishedPosts, toLinkablePosts } from "../../../lib/builder/published-posts";
import { getBuilderAdminClient } from "../../../lib/supabase/admin";
import site from "../../../builder.config";
import { EditorClient } from "./editor-client";
import { resolveEditorPagePath } from "./editor-path";

export const dynamic = "force-dynamic";

type AdminEditorPageProps = {
  searchParams: Promise<{ path?: string | string[] }>;
};

export default async function AdminEditorPage({ searchParams }: AdminEditorPageProps) {
  const query = await searchParams;
  const initialPath = resolveEditorPagePath(query.path, site.pages) ?? "/";
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const identity = await authenticateBuilderRequest(new Request(`${origin}/admin/editor`, {
    headers: { cookie: incoming.get("cookie") ?? "" }
  }));
  if (!identity) redirect("/admin/login?returnTo=%2Fadmin%2Feditor");
  const client = getBuilderAdminClient();
  const linkablePosts = client ? toLinkablePosts(await listPublishedPosts(client)) : [];
  return (
    <EditorClient
      initialLinkablePosts={linkablePosts}
      initialPath={initialPath}
      memberId={identity.userId}
      previewBaseUrl={origin}
      role={identity.role}
    />
  );
}
