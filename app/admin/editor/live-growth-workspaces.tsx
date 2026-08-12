"use client";

import { SubmissionsWorkspace, type BuilderWorkspaceId } from "@reuben-williams/editor";
import { DashboardWorkspace, type DashboardDestination } from "@reuben-williams/growth-dashboard/ui";
import { CustomersWorkspace } from "@reuben-williams/growth-customers/ui";
import { LeadsWorkspace } from "@reuben-williams/growth-leads/ui";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

import type { LiveGrowthClient } from "../../../lib/growth/client";

type LiveWorkspaceProps = {
  client: LiveGrowthClient;
  memberId: string;
  role: "owner" | "editor" | "contributor" | "viewer";
};

type LiveGrowthWorkspaceKind = "overview" | "submissions" | "leads" | "customers";

export function liveGrowthEmptyCopy(kind: LiveGrowthWorkspaceKind) {
  if (kind === "overview") return "When every total is zero, there is no live form or growth activity in the selected period.";
  const record = kind === "submissions" ? "submission" : kind === "leads" ? "lead" : "customer";
  return `When this workspace is empty, there are no live ${record} records to review.`;
}

function LiveDataLabel({ children, kind }: { children: ReactNode; kind: LiveGrowthWorkspaceKind }) {
  return (
    <div data-growth-live-workspace>
      <p className="editor-live-data-label">
        <span><strong>Live production data</strong>No demo or placeholder records are loaded.</span>
        <span>{liveGrowthEmptyCopy(kind)} <Link href="/admin/editor?workspace=website.forms#authentic-live-form-checklist">Open the controlled checklist</Link>.</span>
      </p>
      {children}
    </div>
  );
}

function openWorkspace(destination: DashboardDestination) {
  const workspace: Partial<Record<DashboardDestination, BuilderWorkspaceId>> = {
    leads: "growth.leads",
    customers: "growth.customers",
    submissions: "website.submissions"
  };
  const next = workspace[destination];
  if (!next) return;
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", next);
  window.location.replace(`${url.pathname}${url.search}`);
}

export function LiveDashboardWorkspace({ client, role }: LiveWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<LiveGrowthClient["dashboard"]>>>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void client.dashboard().then((value) => {
      if (active) setSnapshot(value);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [client]);

  return (
    <LiveDataLabel kind="overview">
      <DashboardWorkspace
        access={{
          dashboard: { effectiveRead: true, hasCapability: true },
          leads: { effectiveRead: true, hasRecordCapability: true, state: "active" },
          customers: { effectiveRead: true, hasRecordCapability: true, state: "active" }
        }}
        actorRole={role}
        {...(failed ? { errorMessage: "The production dashboard is temporarily unavailable." } : {})}
        mode={failed ? "error" : snapshot ? "operational" : "loading"}
        onNavigate={openWorkspace}
        onResetDemo={() => undefined}
        {...(snapshot ? { snapshot } : {})}
      />
    </LiveDataLabel>
  );
}

export function LiveLeadsWorkspace({ client, memberId }: LiveWorkspaceProps) {
  return (
    <LiveDataLabel kind="leads">
      <LeadsWorkspace
        access={{
          memberId,
          scope: "site",
          canRead: true,
          canCreate: true,
          canUpdate: true,
          canAssignOthers: true,
          canManageTasks: true,
          canExport: false
        }}
        api={client.leadsApi}
        assignees={[]}
        mode="operational"
        onResetDemo={() => undefined}
        onUrlStateChange={() => undefined}
        savedViews={[]}
        services={["Constituent services", "Community inquiry", "Legislative inquiry", "District office request"]}
        tags={[]}
        urlState={{ view: "all", sort: "updated_at", direction: "desc" }}
      />
    </LiveDataLabel>
  );
}

export function LiveCustomersWorkspace({ client }: LiveWorkspaceProps) {
  const [page, setPage] = useState<Awaited<ReturnType<LiveGrowthClient["customersApi"]["list"]>>>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void client.customersApi.list({}).then((value) => {
      if (active) setPage(value);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [client]);

  return (
    <LiveDataLabel kind="customers">
      <CustomersWorkspace
        access={{
          scope: "site",
          canRead: true,
          canUpdate: true,
          canReviewMerge: false,
          canExport: false,
          canRequestDeletion: false,
          canManageTags: false,
          canShareSegments: false
        }}
        api={client.customersApi}
        {...(failed ? { errorMessage: "Production customer data is temporarily unavailable." } : {})}
        {...(page ? { initialPage: page } : {})}
        mode={failed ? "error" : page ? "operational" : "loading"}
        onResetDemo={() => undefined}
        onUrlStateChange={() => undefined}
        savedSegments={[]}
      />
    </LiveDataLabel>
  );
}

export function LiveSubmissionsWorkspace({ client, role }: LiveWorkspaceProps) {
  return (
    <LiveDataLabel kind="submissions">
      <SubmissionsWorkspace api={client.submissionsApi} initialQuery={{ limit: 25 }} role={role} />
    </LiveDataLabel>
  );
}
