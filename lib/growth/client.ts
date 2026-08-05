"use client";

import type {
  BaseSubmissionDetail,
  SubmissionsApi,
  SubmissionsListQuery,
  SubmissionMutationResult
} from "@reuben-williams/editor";
import type { DashboardFactsSnapshot } from "@reuben-williams/growth-dashboard";
import type {
  CustomerWorkspaceDetail,
  CustomersWorkspaceApi
} from "@reuben-williams/growth-customers/ui";
import type {
  LeadWorkspaceApi,
  LeadWorkspaceCommandResult,
  LeadWorkspaceMutationResult
} from "@reuben-williams/growth-leads/ui";

type Projection<T> =
  | { version: 1; status: "allowed" | "read_only" | "stale"; data: T }
  | { version: 1; status: "restricted" | "not_found" };

type LeadReadPage = {
  items: readonly Record<string, unknown>[];
  nextCursor?: string;
};

type CustomerReadPage = {
  items: readonly Record<string, unknown>[];
  nextCursor?: string;
};

type DashboardReadProjection = {
  leads: Record<string, unknown>;
  customers: Record<string, unknown>;
  tasks: Record<string, unknown>;
  notifications: Record<string, unknown>;
  baseSubmissions: Record<string, unknown>;
  health: Record<string, unknown>;
};

type SubmissionReadPage = {
  items: readonly Record<string, unknown>[];
  nextCursor?: string;
};

type OperationEnvelope = {
  result?: "applied" | "conflict" | "denied";
  resource?: { type: string; id: string };
  version?: number;
  expectedVersion?: number;
  actualVersion?: number;
  code?: string;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

async function post<T>(path: string, body: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const response = await fetch(`/api/growth/${path}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(text(object(object(payload).error).code, "GROWTH_UNAVAILABLE"));
  return payload as T;
}

async function query<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const projection = await post<Projection<T>>(path, body);
  if (projection.status === "restricted" || projection.status === "not_found") {
    throw new Error("GROWTH_ACCESS_RESTRICTED");
  }
  if (!("data" in projection)) throw new Error("GROWTH_ACCESS_RESTRICTED");
  return projection.data;
}

function idempotencyKey(): string {
  return crypto.randomUUID();
}

function leadMutation(result: OperationEnvelope): LeadWorkspaceMutationResult {
  if (result.result === "applied" && result.resource?.id && result.version !== undefined) {
    return { result: "applied", leadId: result.resource.id, version: result.version };
  }
  if (result.result === "conflict") {
    return {
      result: "conflict",
      expectedVersion: result.expectedVersion ?? 0,
      actualVersion: result.actualVersion ?? 0
    };
  }
  return { result: "denied", reason: "not_authorized" };
}

function leadCommand(result: OperationEnvelope): LeadWorkspaceCommandResult {
  if (result.result === "applied") {
    return {
      status: "applied",
      ...(result.resource?.id ? { resourceId: result.resource.id } : {}),
      ...(result.version !== undefined ? { version: result.version } : {})
    };
  }
  if (result.result === "conflict") return { status: "conflict", actualVersion: result.actualVersion ?? 0 };
  return { status: "denied", message: "This operation is not available for the current account." };
}

function customerCommand(result: OperationEnvelope) {
  if (result.result === "applied") {
    return {
      status: "applied" as const,
      ...(result.resource?.id ? { resourceId: result.resource.id } : {}),
      ...(result.version !== undefined ? { version: result.version } : {})
    };
  }
  if (result.result === "conflict") return { status: "conflict" as const, actualVersion: result.actualVersion ?? 0 };
  return { status: "denied" as const, message: "This operation is not available for the current account." };
}

function mapLeadPage(page: LeadReadPage) {
  return {
    items: page.items.map((item) => ({
      id: text(item.id),
      customerId: text(item.contactId),
      customerDisplayName: text(item.displayName, "Contact"),
      service: text(item.service, "General inquiry"),
      urgency: text(item.urgency, "standard") as "standard" | "urgent" | "emergency",
      priority: text(item.priority, "normal") as "low" | "normal" | "high" | "urgent",
      status: text(item.status, "new") as "new" | "contacted" | "qualified" | "won" | "lost" | "spam",
      displayLane: text(item.status, "new") as "new" | "contacted" | "qualified" | "won" | "lost" | "spam",
      ...(item.primaryAssigneeId ? { assigneeId: text(item.primaryAssigneeId) } : {}),
      createdAt: text(item.createdAt),
      updatedAt: text(item.updatedAt),
      version: number(item.version, 1)
    })),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
  };
}

function mapLeadDetail(value: Record<string, unknown>) {
  const lead = object(value.lead);
  const customer = object(value.customer);
  const identities = Array.isArray(value.identities) ? value.identities.map(object) : [];
  const timeline = Array.isArray(value.timeline) ? value.timeline.map(object) : [];
  const tags = Array.isArray(value.tags) ? value.tags.map(object) : [];
  const tasks = Array.isArray(value.tasks) ? value.tasks.map(object) : [];
  const serviceEvents = Array.isArray(value.serviceEvents) ? value.serviceEvents.map(object) : [];
  const submission = object(value.submission);
  return {
    lead: {
      id: text(lead.id),
      siteId: text(lead.siteId),
      contactId: text(lead.contactId),
      source: text(lead.source, "website_form") as "website_form" | "phone" | "walk_in" | "staff_entry",
      service: text(lead.service, "General inquiry"),
      urgency: text(lead.urgency, "standard") as "standard" | "urgent" | "emergency",
      priority: text(lead.priority, "normal") as "low" | "normal" | "high" | "urgent",
      status: text(lead.status, "new") as "new" | "contacted" | "qualified" | "won" | "lost" | "spam",
      summary: text(lead.summary),
      ...(lead.primaryAssigneeId ? { primaryAssigneeId: text(lead.primaryAssigneeId) } : {}),
      version: number(lead.version, 1),
      createdAt: text(lead.createdAt),
      updatedAt: text(lead.updatedAt),
      timeline: timeline.map((event) => ({
        id: text(event.id),
        siteId: text(lead.siteId),
        leadId: text(lead.id),
        kind: text(event.kind, "created") as "created",
        ...(event.actorId ? { actorId: text(event.actorId) } : {}),
        occurredAt: text(event.createdAt)
      }))
    },
    customer: {
      id: text(customer.id),
      displayName: text(customer.displayName, "Contact"),
      identities: identities.map((identity) => ({
        kind: text(identity.kind, "external") as "email" | "phone" | "external",
        display: text(identity.value),
        verified: text(identity.verificationState) === "verified"
      }))
    },
    tags: tags.map((tag) => ({ id: text(tag.id), label: text(tag.label), ...(tag.colorToken ? { color: text(tag.colorToken) } : {}) })),
    tasks: tasks.map((task) => ({
      id: text(task.id),
      siteId: text(lead.siteId),
      relatedType: "lead" as const,
      relatedId: text(lead.id),
      title: text(task.title),
      status: (text(task.state, "open") === "in_progress" ? "assigned" : text(task.state, "open")) as "open" | "assigned" | "completed" | "cancelled",
      priority: text(task.priority, "normal") as "low" | "normal" | "high" | "urgent",
      ...(task.assigneeId ? { assigneeId: text(task.assigneeId) } : {}),
      ...(task.dueAt ? { dueAt: text(task.dueAt) } : {}),
      version: number(task.version, 1)
    })),
    serviceEvents: serviceEvents.flatMap((event) => {
      const kind = text(event.eventKind);
      if (!["estimate.sent", "estimate.accepted", "estimate.declined", "appointment.scheduled", "appointment.rescheduled", "appointment.cancelled", "appointment.completed"].includes(kind)) return [];
      return [{
        id: text(event.id),
        siteId: text(lead.siteId),
        contactId: text(lead.contactId),
        leadId: text(lead.id),
        kind: kind as "estimate.sent" | "estimate.accepted" | "estimate.declined" | "appointment.scheduled" | "appointment.rescheduled" | "appointment.cancelled" | "appointment.completed",
        origin: { type: "manual" as const, actor: { type: "system" as const } },
        occurredAt: text(event.occurredAt),
        correlationId: text(event.id)
      }];
    }),
    ...(submission.id ? {
      submission: {
        id: text(submission.id),
        capturedAt: text(submission.receivedAt),
        safeCode: text(submission.resultCode)
      }
    } : {})
  };
}

function mapCustomerPage(page: CustomerReadPage) {
  return {
    items: page.items.map((item) => ({
      id: text(item.id),
      displayName: text(item.displayName, "Contact"),
      identitySummary: [],
      tags: [],
      latestActivityAt: text(item.latestActivityAt, text(item.updatedAt)),
      openLeadCount: 0,
      version: number(item.version, 1)
    })),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
  };
}

function mapCustomerDetail(value: Record<string, unknown>): CustomerWorkspaceDetail {
  const customer = object(value.customer);
  const identities = Array.isArray(value.identities) ? value.identities.map(object) : [];
  const preferences = Array.isArray(value.preferences) ? value.preferences.map(object) : [];
  const suppressions = Array.isArray(value.suppressions) ? value.suppressions.map(object) : [];
  const tags = Array.isArray(value.tags) ? value.tags.map(object) : [];
  const leads = Array.isArray(value.leads) ? value.leads.map(object) : [];
  const serviceEvents = Array.isArray(value.serviceEvents) ? value.serviceEvents.map(object) : [];
  const merges = Array.isArray(value.mergeSuggestions) ? value.mergeSuggestions.map(object) : [];
  const exports = Array.isArray(value.exports) ? value.exports.map(object) : [];
  return {
    profile: {
      id: text(customer.id),
      siteId: text(customer.siteId),
      displayName: text(customer.displayName, "Contact"),
      lifecycleState: text(customer.lifecycleState, "active") as "active" | "inactive" | "merged" | "deleted",
      preferredContactMethod: text(customer.preferredContactMethod, "none") as "email" | "phone" | "none",
      ...(customer.serviceZipCode ? { serviceAreaZip: text(customer.serviceZipCode) } : {}),
      identities: identities.map((identity) => ({
        kind: text(identity.kind, "external") as "email" | "phone" | "external",
        display: text(identity.value),
        verified: text(identity.verificationState) === "verified"
      })),
      preferences: preferences.map((preference) => ({ key: text(preference.key), value: text(preference.value) })),
      suppressions: suppressions.map((suppression) => ({
        channel: text(suppression.channel, "email") as "email" | "sms",
        reasonCode: text(suppression.reason),
        active: bool(suppression.active)
      })),
      tags: tags.map((tag) => ({ id: text(tag.id), label: text(tag.label), ...(tag.colorToken ? { color: text(tag.colorToken) } : {}) })),
      relatedRecords: {
        leadCount: leads.length,
        openTaskCount: 0,
        serviceEventCount: serviceEvents.length
      },
      duplicateReview: { state: merges.some((merge) => text(merge.reviewState) === "pending") ? "suggested" : "none", suggestionCount: merges.length },
      version: number(customer.version, 1),
      createdAt: text(customer.createdAt),
      updatedAt: text(customer.updatedAt)
    },
    activity: [
      ...leads.map((lead) => ({ id: text(lead.id), kind: "lead" as const, label: text(lead.service, "Inquiry"), occurredAt: text(lead.updatedAt) })),
      ...serviceEvents.map((event) => ({ id: text(event.id), kind: "service_event" as const, label: text(event.eventKind, "Service event"), occurredAt: text(event.occurredAt) }))
    ],
    mergeSuggestions: merges.map((merge) => ({
      id: text(merge.id),
      candidateCustomerId: text(merge.rightCustomerId),
      candidateCustomerVersion: 1,
      candidateDisplayName: "Potential duplicate",
      confidence: text(merge.confidenceBand, "low") as "low" | "medium" | "high",
      state: text(merge.reviewState) === "dismissed" ? "dismissed" : text(merge.reviewState) === "accepted" ? "accepted" : "suggested",
      version: number(merge.version, 1)
    })),
    exportJobs: exports.map((job) => ({
      id: text(job.id),
      state: text(job.state, "queued") as "queued" | "running" | "completed" | "failed" | "expired",
      requestedAt: text(job.createdAt)
    })),
    preferenceVersions: Object.fromEntries(preferences.map((preference) => [text(preference.key), number(preference.version, 1)])),
    suppressionVersions: Object.fromEntries(suppressions.map((suppression) => [text(suppression.channel), 1]))
  };
}

function mapDashboard(value: DashboardReadProjection, siteId: string): DashboardFactsSnapshot {
  const facts: DashboardFactsSnapshot["facts"][number][] = [];
  if (value.leads.status === "allowed") {
    facts.push({ kind: "lead_aging", domain: "leads", buckets: [{ minimumAgeDays: 3, maximumAgeDays: null, count: number(value.leads.agingCount) }] });
    facts.push({ kind: "unassigned_leads", domain: "leads", count: number(value.leads.unassignedCount) });
  }
  if (value.tasks.status === "allowed") facts.push({ kind: "task_deadlines", domain: "leads", dueCount: number(value.tasks.dueTodayCount), overdueCount: number(value.tasks.overdueCount) });
  if (value.customers.status === "allowed") facts.push({ kind: "customer_activity", domain: "customers", activeCount: number(value.customers.activeCount) });
  if (value.notifications.status === "allowed") facts.push({ kind: "notification_count", domain: "dashboard", unreadCount: number(value.notifications.unreadCount) });
  if (value.baseSubmissions.status === "allowed") facts.push({ kind: "base_inbox", domain: "base_submissions", newCount: number(value.baseSubmissions.recentCount), spamReviewCount: number(value.baseSubmissions.spamReviewCount) });
  if (value.health.status === "allowed") {
    const items = Array.isArray(value.health.items) ? value.health.items.map(object) : [];
    facts.push({
      kind: "module_health",
      domain: "dashboard",
      warningCount: items.filter((item) => text(item.status) === "warning").length,
      criticalCount: items.filter((item) => text(item.status) === "critical").length
    });
  }
  return { siteId, generatedAt: new Date().toISOString(), facts };
}

function submissionName(payload: Record<string, unknown>): string {
  const full = text(payload.name).trim();
  if (full) return full;
  const parts = [text(payload.firstName), text(payload.lastName)].filter(Boolean).join(" ").trim();
  return parts || text(payload.email, "Submission");
}

function mapSubmissionSummary(item: Record<string, unknown>) {
  const result = object(item.currentResult);
  const metadata = object(result.safeMetadata);
  const resultCode = text(result.resultCode, "base_only");
  return {
    id: text(item.id),
    formId: text(item.formId),
    sourcePage: text(item.source, "/"),
    displayName: submissionName(metadata),
    capturedAt: text(item.receivedAt),
    reviewState: (resultCode === "spam" ? "spam" : "new") as "spam" | "new",
    enhancementState: (resultCode === "enhanced" ? "enhanced" : resultCode === "review_required" || resultCode === "identity_conflict" ? "review_required" : "base_only") as "enhanced" | "review_required" | "base_only",
    version: number(result.version, 1)
  };
}

function mapSubmissionDetail(value: Record<string, unknown>): BaseSubmissionDetail {
  const submission = object(value.submission);
  const payload = object(submission.payload);
  const results = Array.isArray(value.results) ? value.results.map(object) : [];
  const latest = results.at(-1) ?? {};
  const summary = mapSubmissionSummary({ ...submission, currentResult: latest });
  const events = Array.isArray(value.events) ? value.events.map(object) : [];
  const consents = Array.isArray(value.consents) ? value.consents.map(object) : [];
  return {
    ...summary,
    fields: Object.entries(payload).flatMap(([key, value]) => {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return [];
      return [{ key, label: key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()), value: String(value) }];
    }),
    activity: events.map((event) => ({
      id: text(event.id),
      title: text(event.eventKind).replaceAll("_", " "),
      occurredAt: text(event.createdAt)
    })),
    ...(consents[0] ? {
      privacy: {
        consent: {
          state: "active" as const,
          purpose: text(consents[0].purpose, "general_contact") as "service_request" | "estimate_request" | "general_contact" | "marketing_email",
          policyVersion: text(consents[0].policyVersion, "1")
        },
        deletion: { state: "none" as const },
        retention: { rawRetentionDays: 365, effectiveAt: text(submission.receivedAt) }
      }
    } : {})
  };
}

export function createLiveGrowthClient(siteId: string) {
  const leadsApi: LeadWorkspaceApi = {
    externalEffects: false,
    list: async (input) => mapLeadPage(await query<LeadReadPage>("queries/leads", {
      ...(input.search ? { search: input.search } : {}),
      ...(input.filter ? { filter: input.filter } : {}),
      ...(input.sort ? { sort: input.sort } : {}),
      ...(input.direction ? { direction: input.direction } : {}),
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {})
    })),
    get: async (leadId) => {
      try { return mapLeadDetail(await query<Record<string, unknown>>(`queries/leads/${leadId}`, {})); }
      catch { return null; }
    },
    createManual: async (input) => {
      const key = idempotencyKey();
      return leadMutation(await post<OperationEnvelope>("operations/leads/manual", { idempotencyKey: key, ...input }, key));
    },
    changeStatus: async ({ leadId, ...input }) => {
      const key = idempotencyKey();
      return leadMutation(await post<OperationEnvelope>(`operations/leads/${leadId}/status`, { idempotencyKey: key, ...input }, key));
    },
    setPriority: async ({ leadId, ...input }) => {
      const key = idempotencyKey();
      return leadMutation(await post<OperationEnvelope>(`operations/leads/${leadId}/priority`, { idempotencyKey: key, ...input }, key));
    },
    assign: async ({ leadId, ...input }) => {
      const key = idempotencyKey();
      return leadMutation(await post<OperationEnvelope>(`operations/leads/${leadId}/assignment`, { idempotencyKey: key, ...input }, key));
    },
    addNote: async ({ leadId, ...input }) => {
      const key = idempotencyKey();
      return leadMutation(await post<OperationEnvelope>(`operations/leads/${leadId}/note`, { idempotencyKey: key, ...input }, key));
    },
    bulkStatus: async ({ records }) => ({ requestedCount: records.length, results: records.map((record) => ({ leadId: record.leadId, status: "denied" as const, reason: "not_authorized" as const })) }),
    bulkAssign: async ({ records }) => ({ requestedCount: records.length, results: records.map((record) => ({ leadId: record.leadId, status: "denied" as const, reason: "not_authorized" as const })) }),
    bulkTag: async ({ records }) => ({ requestedCount: records.length, results: records.map((record) => ({ leadId: record.leadId, status: "denied" as const, reason: "not_authorized" as const })) }),
    requestExport: async () => ({ status: "denied", message: "Exports require recent identity verification." }),
    saveView: async () => ({ status: "denied", message: "Saved views are not enabled for this release." }),
    removeView: async () => ({ status: "denied", message: "Saved views are not enabled for this release." })
  };

  const customersApi: CustomersWorkspaceApi = {
    list: async (input) => mapCustomerPage(await query<CustomerReadPage>("queries/customers", {
      ...(input.search ? { search: input.search } : {}),
      sort: "updated_at",
      direction: "desc",
      limit: 50,
      ...(input.cursor ? { cursor: input.cursor } : {})
    })),
    get: async (customerId) => {
      try { return mapCustomerDetail(await query<Record<string, unknown>>(`queries/customers/${customerId}`, {})); }
      catch { return null; }
    },
    updateProfile: async ({ customerId, ...input }) => {
      const key = idempotencyKey();
      return customerCommand(await post<OperationEnvelope>(`operations/customers/${customerId}/profile`, { idempotencyKey: key, ...input }, key));
    },
    reviewMerge: async () => ({ status: "denied", message: "Merge review is not available in this release." }),
    executeMerge: async () => ({ status: "denied", message: "Merge execution is not available in this release." }),
    requestExport: async () => ({ status: "denied", message: "Exports require recent identity verification." }),
    requestDeletion: async () => ({ status: "aal2_required", message: "Recent identity verification is required." }),
    setPreference: async () => ({ status: "denied", message: "Preference editing is not available in this release." }),
    clearPreference: async () => ({ status: "denied", message: "Preference editing is not available in this release." }),
    suppress: async () => ({ status: "denied", message: "Provider channels are not configured." }),
    unsuppress: async () => ({ status: "denied", message: "Provider channels are not configured." }),
    addTag: async () => ({ status: "denied", message: "Tag management is not enabled in this release." }),
    removeTag: async () => ({ status: "denied", message: "Tag management is not enabled in this release." }),
    saveSegment: async () => ({ status: "denied", message: "Saved segments are not enabled in this release." }),
    removeSegment: async () => ({ status: "denied", message: "Saved segments are not enabled in this release." })
  };

  const submissionsApi: SubmissionsApi = {
    list: async (input: SubmissionsListQuery) => {
      const resultCodes = input.reviewState === "spam" ? ["spam"] : undefined;
      const page = await query<SubmissionReadPage>("queries/submissions", {
        ...(input.search ? { search: input.search } : {}),
        ...(resultCodes ? { resultCodes } : {}),
        limit: input.limit ?? 25,
        ...(input.cursor ? { cursor: input.cursor } : {})
      });
      const items = page.items.map(mapSubmissionSummary);
      return {
        items,
        newCount: items.filter((item) => item.reviewState === "new").length,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
      };
    },
    detail: async (submissionId) => mapSubmissionDetail(await query<Record<string, unknown>>(`queries/submissions/${submissionId}`, {})),
    markSpam: async ({ submissionId, expectedVersion }) => {
      const key = idempotencyKey();
      const result = await post<OperationEnvelope>(`operations/submissions/${submissionId}/spam`, { idempotencyKey: key, expectedVersion, reason: "staff_review" }, key);
      return result.result === "applied" ? { status: "applied", version: result.version ?? expectedVersion + 1 } : { status: "denied", reason: "not_authorized" };
    },
    restore: async ({ submissionId, expectedVersion }) => {
      const key = idempotencyKey();
      const result = await post<OperationEnvelope>(`operations/submissions/${submissionId}/restore`, { idempotencyKey: key, expectedVersion }, key);
      return result.result === "applied" ? { status: "applied", version: result.version ?? expectedVersion + 1 } : { status: "denied", reason: "not_authorized" };
    },
    requestExport: async () => ({ status: "denied", reason: "Recent identity verification is required." })
  };

  return {
    siteId,
    leadsApi,
    customersApi,
    submissionsApi,
    dashboard: async () => mapDashboard(await query<DashboardReadProjection>("queries/dashboard", {}), siteId)
  };
}

export type LiveGrowthClient = ReturnType<typeof createLiveGrowthClient>;
