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
import { createHttpMediaUploadClient, type MediaUploadState } from "../../../lib/builder/media-client";
import { editorFetch } from "../../../lib/builder/editor-fetch";
import { EditorSafetyFrame } from './editor-safety-frame';
import { createHttpCalendarClient } from "../../../lib/calendar/client";
import { builderSessionCookies } from "../../../lib/builder/session-cookies";
import { createLiveGrowthClient } from "../../../lib/growth/client";
import { getSupabaseBrowserClient } from "../../../lib/supabase/client";
import { EditorOperationalHeader } from "./editor-operational-header";
import { withPublicationFeedback,type PublicationFeedback } from '../../../lib/builder/page-publication-status';
import { PagePublicationStatusPanel } from './page-publication-status';
import { BilingualReadinessWorkspace } from "./bilingual-readiness-workspace";
import { CalendarWorkspace } from "./calendar-workspace";
import dynamic from 'next/dynamic';
import { createCarouselClient } from '../../../lib/carousel/client';
import { readSiteHistory } from '../../../lib/builder/history-client';
const CarouselStudio=dynamic(()=>import('./carousel-studio').then(module=>module.CarouselStudio),{loading:()=> <p>Loading Carousel Studio…</p>});
import { FormsGuidanceWorkspace } from "./forms-guidance-workspace";
import { MediaLibraryWorkspace } from "./media-library-workspace";
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
  width?: number;
  height?: number;
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
    width: typeof value.width==='number'?value.width:undefined,
    height: typeof value.height==='number'?value.height:undefined,
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
const CALENDAR_WORKSPACE_ID = "website.calendar" as BuilderWorkspaceId;

export function EditorClient({
  initialAlertCollection,
  initialLinkablePosts,
  initialPath,
  initialWorkspaceId,
  memberId,
  previewBaseUrl,
  role
}: {
  initialAlertCollection?: AlertManagementCollectionV1 | null;
  initialLinkablePosts: LinkablePost[];
  initialPath: string;
  initialWorkspaceId?: string;
  memberId: string;
  previewBaseUrl: string;
  role: "owner" | "editor" | "contributor" | "viewer";
}) {
  const [currentPath, setCurrentPath] = useState(
    () => resolveEditorPagePath(initialPath, site.pages) ?? "/"
  );
  const [linkablePosts, setLinkablePosts] = useState(initialLinkablePosts);
  const [mediaAssets, setMediaAssets] = useState<ManagedMediaChoice[]>([]);
  const [uploadState, setUploadState] = useState<MediaUploadState>({status:'idle'});
  const [editorTransport, setEditorTransport] = useState<typeof editorFetch>(() => editorFetch);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [mediaLoading, setMediaLoading] = useState(true);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const libraryChanged = useCallback(() => setLibraryRevision(value => value + 1), []);
  const [historySource,setHistorySource]=useState("all");
  const [publicationRevision,setPublicationRevision]=useState(0);
  const [publicationResult,setPublicationResult]=useState<PublicationFeedback|null>(null);
  const publicationFeedback=useCallback((result:PublicationFeedback)=>{
    setPublicationResult(result);setPublicationRevision(value=>value+1);
  },[]);
  const [workspaceShown,setWorkspaceShown]=useState(()=>initialWorkspaceId ?? (typeof window==="undefined"?"":new URLSearchParams(window.location.search).get("workspace") ?? ""));
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
      storage: supabase.storage.from("builder-media"),
      onUploadState: setUploadState
    }) : null;
  }, []);
  const client = useMemo(() => {
    // A library change invalidates the attached editor's cached gallery as well.
    void libraryRevision;
    const attached = withPublicationFeedback(createHttpAttachedSiteEditorClient({
      baseUrl: "/api/builder",
      getCsrfToken: csrfCookie,
      fetcher: editorTransport
    }),publicationFeedback);
    return {
      ...attached,
      listHistory: (query: Parameters<typeof readSiteHistory>[0])=>readSiteHistory(query,historySource==="carousel"),
      ...(mediaUpload?{uploadMedia: mediaUpload.uploadMedia}:{}),
      ...(role === "owner" && mediaUpload ? { uploadMediaBatch: mediaUpload.uploadMediaBatch } : {})
    };
  // Recreate the attached client after sign-in so its gallery/history are refreshed.
  }, [mediaUpload, role, historySource,publicationFeedback,editorTransport,libraryRevision]);
  const refreshMedia = useCallback(async () => {
    setMediaLoading(true);
    try {
      const assets = await client.listMedia();
      setMediaAssets(assets.map(managedMediaChoice).filter((asset): asset is ManagedMediaChoice => Boolean(asset)));
      setMediaError("");
    } catch {
      setMediaError("The current private media gallery could not be loaded. Try again.");
    } finally {
      setMediaLoading(false);
    }
  }, [client]);
  useEffect(() => {
    let active = true;
    void client.listMedia().then((assets) => {
      if (!active) return;
      setMediaAssets(assets.map(managedMediaChoice).filter((asset): asset is ManagedMediaChoice => Boolean(asset)));
      setMediaError("");
    }).catch(() => {
      if (active) setMediaError("The current private media gallery could not be loaded. Try again.");
    }).finally(() => {
      if (active) setMediaLoading(false);
    });
    return () => { active = false; };
  }, [client]);
  const growth = useMemo(() => createLiveGrowthClient(site.siteId, {
    getCsrfToken: csrfCookie,
    // The shared request adapter opens a recovery prompt without discarding edits.
    onAuthenticationRequired: () => {}
  }), []);
  const posts = useMemo(() => createHttpPostsClient({
    baseUrl: "/api/builder/posts",
    getCsrfToken: csrfCookie,
    onLinkablePostsChanged: setLinkablePosts
  }), []);
  const alerts = useMemo(() => new BuilderApiClient({
    baseUrl: "/api/builder",
    getCsrfToken: csrfCookie,
    fetcher: editorFetch,
  }), []);
  const calendar = useMemo(() => createHttpCalendarClient({ getCsrfToken: csrfCookie }), []);
  const carousel = useMemo(() => createCarouselClient(), []);
  const uploadCarouselMedia=useCallback(async(file:File,metadata:{label:string;alt:string})=>{
    if(!mediaUpload)throw new Error('Media upload is unavailable.');
    const uploaded=managedMediaChoice(await mediaUpload.uploadMedia(file,metadata));await refreshMedia();
    if(!uploaded)throw new Error('The uploaded media revision could not be confirmed.');
    return {mediaId:uploaded.mediaId,revisionId:uploaded.revisionId};
  },[mediaUpload,refreshMedia]);
  const calendarMediaAssets = useMemo(
    () => mediaAssets.filter(asset => asset.mimeType.startsWith("image/")),
    [mediaAssets]
  );
  const registration = useMemo<BuilderShellRegistration>(() => {
    const props = { client: growth, memberId, role };
    const workspaces: readonly RegisteredWorkspace[] = [
      { id: "website.media", label: "Media", group: "website", icon: "images", mobilePriority: 3, status: "active",
        render: () => <MediaLibraryWorkspace role={role} csrf={csrfCookie} upload={mediaUpload?.uploadMedia} onChanged={libraryChanged} /> },
      {
        id:'website.carousel' as BuilderWorkspaceId,label:'Carousel',group:'website',icon:'images',mobilePriority:2,status:'active',
        render:()=> <CarouselStudio role={role} client={carousel} mediaAssets={mediaAssets} mediaError={mediaError} onRefreshMedia={refreshMedia} onUploadMedia={mediaUpload?uploadCarouselMedia:undefined}/>
      },
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
        id: CALENDAR_WORKSPACE_ID, label: "Calendar", group: "website", icon: "calendar-days",
        mobilePriority: 6, status: "active", render: () => (
          <CalendarWorkspace
            client={calendar}
            mediaAssets={calendarMediaAssets}
            mediaLoading={mediaLoading}
            mediaError={mediaError}
            onRefreshMedia={refreshMedia}
            role={role}
          />
        )
      },
      {
        id: LOCALIZATION_WORKSPACE_ID, label: "Bilingual readiness", group: "website", icon: "languages",
        mobilePriority: 7, status: "active", render: () => (
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
      globalHeader: <><EditorOperationalHeader />{workspaceShown==='website.pages' ? <PagePublicationStatusPanel path={currentPath} revision={publicationRevision} result={publicationResult} /> : null}{workspaceShown==="website.history" && <div style={{padding:"12px 24px",background:"#f3f6f9",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}><label>History source <select value={historySource} onChange={event=>setHistorySource(event.target.value)} style={{minHeight:44,padding:8,borderRadius:8,marginLeft:8}}><option value="all">All changes</option><option value="carousel">Carousel</option></select></label><span>For image, caption, order and appearance filters or restoration, open Carousel → History.</span></div>}</>
    };
  }, [alerts, calendar, calendarMediaAssets, carousel, mediaAssets, mediaError, mediaLoading, refreshMedia, mediaUpload, uploadCarouselMedia, currentPath, growth, initialAlertCollection, memberId, previewBaseUrl, role,workspaceShown,historySource,publicationRevision,publicationResult,libraryChanged]);
  const initialWorkspace = (initialWorkspaceId ?? (typeof window === "undefined"
    ? "growth.dashboard"
    : new URLSearchParams(window.location.search).get("workspace") ?? "growth.dashboard")) as BuilderWorkspaceId;

  return (
    <EditorSafetyFrame upload={uploadState} onSessionRestored={() => {
      setEditorTransport(() => {
        const transport: typeof editorFetch = (input, init) => editorFetch(input, init);
        return transport;
      });
      setPublicationRevision(value => value + 1);
    }}>
    <AttachedSiteEditor
      client={client}
      {...editorPageNavigation(currentPath, setCurrentPath)}
      initialWorkspace={initialWorkspace}
      onWorkspaceChange={(workspace) => {
        setWorkspaceShown(workspace);
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
      postsWorkspace={<><aside className="builder-forms-guidance" aria-label="Press Releases publishing guidance"><p>Publishing a press release? Enter <code>press-releases</code> in the post’s <strong>Categories</strong> field, then save and publish. Published, unexpired posts in that category appear on <a href="/news/press-releases" target="_blank" rel="noreferrer">Press Releases</a>. Use a unique release title for the post address; <code>press-releases</code> is reserved for the listing page.</p></aside><ManagedPostsWorkspace
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
      /></>}
      previewBaseUrl={previewBaseUrl}
      registration={registration}
      site={site}
      userViewUrl="/"
      mediaBatchUploadUnavailableReason={role === "owner"
        ? "Private folder import is unavailable until the media service is configured."
        : "Folder import is available to site owners only. Individual uploads remain available for authorized staff."}
    />
    </EditorSafetyFrame>
  );
}
