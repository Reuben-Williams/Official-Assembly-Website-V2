"use client";

import {
  AttachedSiteEditor,
  createHttpAttachedSiteEditorClient,
  type BuilderShellRegistration,
  type BuilderWorkspaceId,
  type RegisteredWorkspace
} from "@reuben-williams/editor";
import { growthCustomersModule } from "@reuben-williams/growth-customers";
import { GROWTH_DASHBOARD_MODULE } from "@reuben-williams/growth-dashboard";
import { growthLeadsModule } from "@reuben-williams/growth-leads";
import { useMemo, useState } from "react";

import site from "../../../builder.config";
import { builderSessionCookies } from "../../../lib/builder/session-cookies";
import { createLiveGrowthClient } from "../../../lib/growth/client";
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

export function EditorClient({
  memberId,
  previewBaseUrl,
  role
}: {
  memberId: string;
  previewBaseUrl: string;
  role: "owner" | "editor" | "contributor" | "viewer";
}) {
  const [endingSession, setEndingSession] = useState(false);
  const client = useMemo(() => createHttpAttachedSiteEditorClient({
    baseUrl: "/api/builder",
    getCsrfToken: csrfCookie
  }), []);
  const growth = useMemo(() => createLiveGrowthClient(site.siteId), []);
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
    return { modules: [GROWTH_DASHBOARD_MODULE, growthLeadsModule, growthCustomersModule], workspaces };
  }, [growth, memberId, role]);
  const initialWorkspace = (typeof window === "undefined"
    ? "growth.dashboard"
    : new URLSearchParams(window.location.search).get("workspace") ?? "growth.dashboard") as BuilderWorkspaceId;

  async function signOut() {
    setEndingSession(true);
    const response = await fetch("/api/builder/session", {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store"
    });
    if (response.ok) window.location.replace("/admin/login");
    else setEndingSession(false);
  }

  return (
    <AttachedSiteEditor
      client={client}
      currentPath="/"
      initialWorkspace={initialWorkspace}
      previewBaseUrl={previewBaseUrl}
      registration={registration}
      site={site}
      userViewUrl="/"
    >
      <div className="editor-attachment-note">
        <p>
          Contact and newsletter use approved managed-form templates. The survey and site-managed
          posts remain unavailable until separately approved and provisioned.
        </p>
        <p>
          Dashboard, submissions, leads, and customers use live production storage. No synthetic
          or placeholder records are loaded. Email, SMS, and AI actions remain unavailable because
          external providers are not configured; no outbound provider work runs from this release.
        </p>
        <button disabled={endingSession} onClick={signOut} type="button">
          {endingSession ? "Ending session…" : "Sign out and revoke editor session"}
        </button>
      </div>
    </AttachedSiteEditor>
  );
}
