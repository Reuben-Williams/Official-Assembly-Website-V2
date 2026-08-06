"use client";

import {
  AttachedPostsWorkspace,
  AttachedSiteEditor,
  createHttpAttachedSiteEditorClient,
  type BuilderShellRegistration,
  type BuilderWorkspaceId,
  type LinkablePost,
  type RegisteredWorkspace
} from "@reuben-williams/editor";
import { growthCustomersModule } from "@reuben-williams/growth-customers";
import { GROWTH_DASHBOARD_MODULE } from "@reuben-williams/growth-dashboard";
import { growthLeadsModule } from "@reuben-williams/growth-leads";
import { useEffect, useMemo, useState } from "react";

import site from "../../../builder.config";
import { createHttpPostsClient } from "../../../lib/builder/posts-client";
import { createHttpMediaUploadClient } from "../../../lib/builder/media-client";
import { builderSessionCookies } from "../../../lib/builder/session-cookies";
import { createLiveGrowthClient } from "../../../lib/growth/client";
import { getSupabaseBrowserClient } from "../../../lib/supabase/client";
import { EditorOperationalHeader } from "./editor-operational-header";
import { resolveEditorPagePath } from "./editor-path";
import {
  LiveCustomersWorkspace,
  LiveDashboardWorkspace,
  LiveLeadsWorkspace,
  LiveSubmissionsWorkspace
} from "./live-growth-workspaces";

function csrfCookie() {
  for (const item of document.cookie.split(";")) {
    const [name, ...rest] = item.trim().split("=");
    if (name === builderSessionCookies.csrf) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function editorPageNavigation(currentPath: string, onPageChange: (path: string) => void) {
  return {
    currentPath,
    onPageChange(path: string) {
      const normalizedPath = resolveEditorPagePath(path, site.pages);
      if (!normalizedPath) return;
      if (normalizedPath === currentPath) return;
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("path", normalizedPath);
        window.history.pushState({}, "", url);
      }
      onPageChange(normalizedPath);
    }
  };
}

export function EditorClient({
  initialLinkablePosts,
  initialPath,
  memberId,
  previewBaseUrl,
  role
}: {
  initialLinkablePosts: LinkablePost[];
  initialPath: string;
  memberId: string;
  previewBaseUrl: string;
  role: "owner" | "editor" | "contributor" | "viewer";
}) {
  const [currentPath, setCurrentPath] = useState(
    () => resolveEditorPagePath(initialPath, site.pages) ?? "/"
  );
  const [linkablePosts, setLinkablePosts] = useState(initialLinkablePosts);
  useEffect(() => {
    const restorePageFromHistory = () => {
      const url = new URL(window.location.href);
      const candidate = url.searchParams.get("path");
      const resolvedPath = resolveEditorPagePath(candidate, site.pages);
      if (candidate !== null && !resolvedPath) {
        url.searchParams.set("path", "/");
        window.history.replaceState({}, "", url);
      }
      setCurrentPath(resolvedPath ?? "/");
    };
    restorePageFromHistory();
    window.addEventListener("popstate", restorePageFromHistory);
    return () => window.removeEventListener("popstate", restorePageFromHistory);
  }, []);
  const client = useMemo(() => {
    const attached = createHttpAttachedSiteEditorClient({
      baseUrl: "/api/builder",
      getCsrfToken: csrfCookie
    });
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return attached;
    const media = createHttpMediaUploadClient({
      baseUrl: "/api/builder/media",
      getCsrfToken: csrfCookie,
      storage: supabase.storage.from("builder-media")
    });
    return {
      ...attached,
      uploadMedia: media.uploadMedia,
      ...(role === "owner" ? { uploadMediaBatch: media.uploadMediaBatch } : {})
    };
  }, [role]);
  const growth = useMemo(() => createLiveGrowthClient(site.siteId), []);
  const posts = useMemo(() => createHttpPostsClient({
    baseUrl: "/api/builder/posts",
    getCsrfToken: csrfCookie,
    onLinkablePostsChanged: setLinkablePosts
  }), []);
  const registration = useMemo<BuilderShellRegistration>(() => {
    const props = { client: growth, memberId, role };
    const workspaces: readonly RegisteredWorkspace[] = [
      {
        id: "growth.dashboard", label: "Overview", group: "growth", icon: "layout-dashboard",
        mobilePriority: 1, status: "active", render: () => <LiveDashboardWorkspace {...props} />
      },
      {
        id: "growth.leads", label: "Leads", group: "growth", icon: "contact-round",
        mobilePriority: 2, status: "active", render: () => <LiveLeadsWorkspace {...props} />
      },
      {
        id: "growth.customers", label: "Customers", group: "growth", icon: "users",
        mobilePriority: 3, status: "active", render: () => <LiveCustomersWorkspace {...props} />
      },
      {
        id: "website.submissions", label: "Submissions", group: "website", icon: "inbox",
        mobilePriority: 4, status: "active", render: () => <LiveSubmissionsWorkspace {...props} />
      }
    ];
    return {
      modules: [GROWTH_DASHBOARD_MODULE, growthLeadsModule, growthCustomersModule],
      workspaces,
      globalHeader: <EditorOperationalHeader />
    };
  }, [growth, memberId, role]);
  const initialWorkspace = (typeof window === "undefined"
    ? "growth.dashboard"
    : new URLSearchParams(window.location.search).get("workspace") ?? "growth.dashboard") as BuilderWorkspaceId;

  return (
    <AttachedSiteEditor
      client={client}
      {...editorPageNavigation(currentPath, setCurrentPath)}
      initialWorkspace={initialWorkspace}
      linkablePosts={linkablePosts}
      postsWorkspace={<AttachedPostsWorkspace client={posts} />}
      previewBaseUrl={previewBaseUrl}
      registration={registration}
      site={site}
      userViewUrl="/"
      mediaBatchUploadUnavailableReason={role === "owner"
        ? "Private folder import is unavailable until the media service is configured."
        : "Folder import is available to site owners only. Individual uploads remain available for authorized staff."}
    />
  );
}
