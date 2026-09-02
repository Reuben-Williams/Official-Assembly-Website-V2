import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseAlertServerRepository } from "@reuben-williams/next/alerts/server";

import { authenticateBuilderRequest } from "../../../lib/builder/request-auth";
import { listPublishedPosts, toLinkablePosts } from "../../../lib/builder/published-posts";
import { getBuilderAdminClient } from "../../../lib/supabase/admin";
import site from "../../../builder.config";
import { EditorClient } from "./editor-client";
import { resolveEditorPagePath } from "./editor-path";

export const dynamic = "force-dynamic";

type AdminEditorPageProps = {
  searchParams: Promise<{
    path?: string | string[];
    workspace?: string | string[];
  }>;
};

const EDITOR_WORKSPACES = new Set([
  "website.pages",
  "website.posts",
  "website.media",
  "website.history",
  "website.submissions",
  "website.forms",
  "website.alerts",
  "website.calendar",
  "website.localization",
  "growth.dashboard",
  "growth.leads",
  "growth.customers"
]);

function firstSearchValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.[0] ?? null;
}

function editorReturnPath(
  query: Awaited<AdminEditorPageProps["searchParams"]>,
  initialPath: string
): string {
  const parameters = new URLSearchParams();
  const workspace = firstSearchValue(query.workspace);
  if (workspace && EDITOR_WORKSPACES.has(workspace)) parameters.set("workspace", workspace);
  if (query.path !== undefined) parameters.set("path", initialPath);
  const suffix = parameters.toString();
  return suffix ? `/admin/editor?${suffix}` : "/admin/editor";
}

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
  if (!identity) {
    const loginParameters = new URLSearchParams({ returnTo: editorReturnPath(query, initialPath) });
    redirect(`/admin/login?${loginParameters}`);
  }
  const client = getBuilderAdminClient();
  const linkablePosts = client ? toLinkablePosts(await listPublishedPosts(client)) : [];
  let initialAlertCollection;
  if (client) {
    try {
      initialAlertCollection = await createSupabaseAlertServerRepository(client).readCollection({
        siteId: identity.siteId,
        siteKey: identity.siteKey,
        userId: identity.userId,
        email: null,
        role: identity.role,
        previewGeneration: identity.sessionGeneration,
      });
    } catch {
      // The client retries this bounded read when the editor opens Alerts.
    }
  }
  return (
    <EditorClient
      initialAlertCollection={initialAlertCollection}
      initialLinkablePosts={linkablePosts}
      initialPath={initialPath}
      memberId={identity.userId}
      previewBaseUrl={origin}
      role={identity.role}
    />
  );
}
