"use client";

import {
  AttachedPostsWorkspace,
  AttachedSiteEditor,
  AlertsWorkspace,
  BuilderApiClient,
  createHttpAttachedSiteEditorClient,
  type AlertManagementCollectionV1,
  type BuilderShellRegistration,
  type BuilderWorkspaceId,
  type LinkablePost,
  type RegisteredWorkspace
} from "@reuben-williams/editor";
import { growthCustomersModule } from "@reuben-williams/growth-customers";
import { GROWTH_DASHBOARD_MODULE } from "@reuben-williams/growth-dashboard";
import { growthLeadsModule } from "@reuben-williams/growth-leads";
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ComponentType } from "react";

import site from "../../../builder.config";
import { createHttpPostsClient } from "../../../lib/builder/posts-client";
import { createHttpMediaUploadClient } from "../../../lib/builder/media-client";
import { builderSessionCookies } from "../../../lib/builder/session-cookies";
import { createLiveGrowthClient } from "../../../lib/growth/client";
import { getSupabaseBrowserClient } from "../../../lib/supabase/client";
import { EditorOperationalHeader } from "./editor-operational-header";
import { BilingualReadinessWorkspace } from "./bilingual-readiness-workspace";
import { FormsGuidanceWorkspace } from "./forms-guidance-workspace";
import { NewsletterOperationsWorkspace } from "./newsletter-operations-workspace";
import { resolveEditorPagePath } from "./editor-path";
import {
  LiveCustomersWorkspace,
  LiveDashboardWorkspace,
  LiveLeadsWorkspace,
  LiveSubmissionsWorkspace
} from "./live-growth-workspaces";

type ManagedMediaChoice = {
  mediaId: string;
  revisionId: string;
  label: string;
  alt: string;
  mimeType: string;
  url: string;
  replicaStatus?: "pending" | "ready" | "failed";
};

type ManagedPostsWorkspaceProps = ComponentProps<typeof AttachedPostsWorkspace> & {
  mediaAssets?: readonly ManagedMediaChoice[];
  mediaUploading?: boolean;
  mediaError?: string;
  onOpenMedia?: () => void;
  onUploadMedia?: (file: File, metadata: { label: string; alt: string }) => void;
};

const ManagedPostsWorkspace = AttachedPostsWorkspace as ComponentType<ManagedPostsWorkspaceProps>;

function managedMediaChoice(asset: unknown): ManagedMediaChoice | null {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) return null;
  const value = asset as Record<string, unknown>;
  if (![value.id, value.revisionId, value.label, value.alt, value.mimeType, value.url]
    .every((field) => typeof field === "string" && field.length > 0)) return null;
  const replicaStatus = value.replicaStatus;
  return {
    mediaId: value.id as string,
    revisionId: value.revisionId as string,
    label: value.label as string,
    alt: value.alt as string,
    mimeType: value.mimeType as string,
    url: value.url as string,
    ...(["pending", "ready", "failed"].includes(String(replicaStatus))
      ? { replicaStatus: replicaStatus as ManagedMediaChoice["replicaStatus"] }
      : {}),
  };
}

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
        url.searchParams.set("workspace", "website.pages");
        url.searchParams.set("path", normalizedPath);
        window.history.pushState({}, "", url);
      }
      onPageChange(normalizedPath);
    }
  };
}

const LOCALIZATION_WORKSPACE_ID = "website.localization" as BuilderWorkspaceId;

export function EditorClient({
  initialAlertCollection,
  initialLinkablePosts,
  initialPath,
  memberId,
  previewBaseUrl,
  role
}: {
  initialAlertCollection?: AlertManagementCollectionV1 | null;
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
  const [mediaAssets, setMediaAssets] = useState<ManagedMediaChoice[]>([]);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaError, setMediaError] = useState("");
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
  const mediaUpload = useMemo(() => {
    const supabase = getSupabaseBrowserClient();
    return supabase ? createHttpMediaUploadClient({
      baseUrl: "/api/builder/media",
      getCsrfToken: csrfCookie,
      storage: supabase.storage.from("builder-media")
    }) : null;
  }, []);
  const client = useMemo(() => {
    const attached = createHttpAttachedSiteEditorClient({
      baseUrl: "/api/builder",
      getCsrfToken: csrfCookie
    });
    if (!mediaUpload) return attached;
    return {
      ...attached,
      uploadMedia: mediaUpload.uploadMedia,
      ...(role === "owner" ? { uploadMediaBatch: mediaUpload.uploadMediaBatch } : {})
    };
  }, [mediaUpload, role]);
  const refreshMedia = useCallback(async () => {
    try {
      const assets = await client.listMedia();
      setMediaAssets(assets.map(managedMediaChoice).filter((asset): asset is ManagedMediaChoice => Boolean(asset)));
      setMediaError("");
    } catch {
      setMediaError("The current private media gallery could not be loaded. Try again.");
    }
  }, [client]);
  const growth = useMemo(() => createLiveGrowthClient(site.siteId, {
    getCsrfToken: csrfCookie,
    onAuthenticationRequired: () => {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/admin/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
  }), []);
  const posts = useMemo(() => createHttpPostsClient({
    baseUrl: "/api/builder/posts",
    getCsrfToken: csrfCookie,
    onLinkablePostsChanged: setLinkablePosts
  }), []);
  const alerts = useMemo(() => new BuilderApiClient({
    baseUrl: "/api/builder",
    getCsrfToken: csrfCookie,
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
      },
      {
        id: "website.alerts", label: "Alerts", group: "website", icon: "megaphone",
        mobilePriority: 5, status: "active", render: () => (
          <AlertsWorkspace
            role={role}
            client={alerts}
            initialCollection={initialAlertCollection}
          />
        )
      },
      {
        id: LOCALIZATION_WORKSPACE_ID, label: "Bilingual readiness", group: "website", icon: "languages",
        mobilePriority: 6, status: "active", render: () => (
          <BilingualReadinessWorkspace
            currentPath={currentPath}
            onOpenPage={editorPageNavigation(currentPath, setCurrentPath).onPageChange}
            previewBaseUrl={previewBaseUrl}
            role={role}
          />
        )
      }
    ];
    return {
      modules: [GROWTH_DASHBOARD_MODULE, growthLeadsModule, growthCustomersModule],
      workspaces,
      globalHeader: <EditorOperationalHeader />
    };
  }, [alerts, currentPath, growth, initialAlertCollection, memberId, previewBaseUrl, role]);
  const initialWorkspace = (typeof window === "undefined"
    ? "growth.dashboard"
    : new URLSearchParams(window.location.search).get("workspace") ?? "growth.dashboard") as BuilderWorkspaceId;

  return (
    <AttachedSiteEditor
      client={client}
      {...editorPageNavigation(currentPath, setCurrentPath)}
      initialWorkspace={initialWorkspace}
      onWorkspaceChange={(workspace) => {
        const url = new URL(window.location.href);
        if (url.searchParams.get("workspace") === workspace) return;
        url.searchParams.set("workspace", workspace);
        window.history.pushState({}, "", url);
      }}
      linkablePosts={linkablePosts}
      formsWorkspace={<FormsGuidanceWorkspace
        role={role}
        newsletterOperations={<NewsletterOperationsWorkspace role={role} />}
      />}
      postsWorkspace={<ManagedPostsWorkspace
        client={posts}
        mediaAssets={mediaAssets}
        mediaUploading={mediaUploading}
        mediaError={mediaError}
        onOpenMedia={() => { void refreshMedia(); }}
        onUploadMedia={(file, metadata) => {
          if (!mediaUpload || mediaUploading) return;
          setMediaUploading(true);
          setMediaError("");
          void mediaUpload.uploadMedia(file, metadata)
            .then(() => refreshMedia())
            .catch(() => setMediaError("The image could not be uploaded. Check the file and try again."))
            .finally(() => setMediaUploading(false));
        }}
      />}
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
