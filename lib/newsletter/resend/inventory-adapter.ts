import "server-only";

import { Resend } from "resend";

import type { NewsletterProviderInventorySnapshot } from "../provider-inventory";

type PageInput = { readonly limit: 100; readonly after?: string };
type Page<T> = {
  readonly items: readonly T[];
  readonly hasMore: boolean;
  readonly after?: string;
};

type SnapshotItem<Key extends keyof NewsletterProviderInventorySnapshot> =
  NewsletterProviderInventorySnapshot[Key] extends readonly (infer Item)[] ? Item : never;

export interface NewsletterProviderInventoryReader {
  probeManagementCredential(): Promise<"authorized" | "unavailable">;
  probeSendCredential(): Promise<"restricted" | "authorized" | "unavailable">;
  listApiKeys(input: PageInput): Promise<Page<SnapshotItem<"apiKeys">>>;
  listAutomations(input: PageInput): Promise<Page<SnapshotItem<"automations">>>;
  listBroadcasts(input: PageInput): Promise<Page<SnapshotItem<"broadcasts">>>;
  listContacts(input: PageInput): Promise<Page<SnapshotItem<"contacts">>>;
  listSegmentContacts(input: PageInput): Promise<Page<SnapshotItem<"segmentContacts">>>;
  listDomains(input: PageInput): Promise<Page<SnapshotItem<"domains">>>;
  listEmails(input: PageInput): Promise<Page<SnapshotItem<"emails">>>;
  listImports(input: PageInput): Promise<Page<SnapshotItem<"imports">>>;
  listOauthGrants(input: PageInput): Promise<Page<SnapshotItem<"oauthGrants">>>;
  listSegments(input: PageInput): Promise<Page<SnapshotItem<"segments">>>;
  listSuppressions(input: PageInput): Promise<Page<SnapshotItem<"suppressions">>>;
  listTemplates(input: PageInput): Promise<Page<SnapshotItem<"templates">>>;
  listTopics(input: PageInput): Promise<Page<SnapshotItem<"topics">>>;
  listWebhooks(input: PageInput): Promise<Page<SnapshotItem<"webhooks">>>;
  listContactProperties(input: PageInput): Promise<Page<SnapshotItem<"contactProperties">>>;
  listCustomEvents(input: PageInput): Promise<Page<SnapshotItem<"customEvents">>>;
  listReceivedEmails(input: PageInput): Promise<Page<SnapshotItem<"receivedEmails">>>;
}

const DEFAULT_MAXIMUM_PAGES = 10_000;

async function allPages<T>(
  list: (input: PageInput) => Promise<Page<T>>,
  maximumPages: number
): Promise<T[]> {
  const items: T[] = [];
  let after: string | undefined;
  const seenCursors = new Set<string>();

  for (let pageNumber = 1; pageNumber <= maximumPages; pageNumber += 1) {
    const page = await list({ limit: 100, after });
    items.push(...page.items);
    if (!page.hasMore) return items;
    if (!page.after || page.after === after || seenCursors.has(page.after)) {
      throw new Error("unsupported_inventory");
    }
    seenCursors.add(page.after);
    after = page.after;
  }

  throw new Error("unsupported_inventory");
}

export async function collectNewsletterProviderInventory(
  reader: NewsletterProviderInventoryReader,
  options: { readonly maximumPages?: number } = {}
): Promise<NewsletterProviderInventorySnapshot> {
  const maximumPages = options.maximumPages ?? DEFAULT_MAXIMUM_PAGES;
  if (!Number.isInteger(maximumPages) || maximumPages < 1) {
    throw new Error("unsupported_inventory");
  }

  const managementProbe = await reader.probeManagementCredential();
  const sendProbe = await reader.probeSendCredential();

  // Deliberately sequential: Resend applies a team-wide request rate limit and
  // inventory correctness is more important than shaving a few milliseconds.
  const apiKeys = await allPages((page) => reader.listApiKeys(page), maximumPages);
  const automations = await allPages((page) => reader.listAutomations(page), maximumPages);
  const broadcasts = await allPages((page) => reader.listBroadcasts(page), maximumPages);
  const contacts = await allPages((page) => reader.listContacts(page), maximumPages);
  const segmentContacts = await allPages(
    (page) => reader.listSegmentContacts(page),
    maximumPages
  );
  const domains = await allPages((page) => reader.listDomains(page), maximumPages);
  const emails = await allPages((page) => reader.listEmails(page), maximumPages);
  const imports = await allPages((page) => reader.listImports(page), maximumPages);
  const oauthGrants = await allPages((page) => reader.listOauthGrants(page), maximumPages);
  const segments = await allPages((page) => reader.listSegments(page), maximumPages);
  const suppressions = await allPages((page) => reader.listSuppressions(page), maximumPages);
  const templates = await allPages((page) => reader.listTemplates(page), maximumPages);
  const topics = await allPages((page) => reader.listTopics(page), maximumPages);
  const webhooks = await allPages((page) => reader.listWebhooks(page), maximumPages);
  const contactProperties = await allPages((page) => reader.listContactProperties(page), maximumPages);
  const customEvents = await allPages((page) => reader.listCustomEvents(page), maximumPages);
  const receivedEmails = await allPages((page) => reader.listReceivedEmails(page), maximumPages);

  return {
    managementCredentialReadable: managementProbe === "authorized",
    sendCredentialManagementRestricted: sendProbe === "restricted",
    domains,
    segments,
    topics,
    webhooks,
    apiKeys,
    contacts,
    segmentContacts,
    suppressions,
    broadcasts,
    emails,
    imports,
    templates,
    automations,
    oauthGrants,
    contactProperties,
    customEvents,
    receivedEmails
  };
}

type ProviderListResult<T> = {
  readonly data: { readonly data: readonly T[]; readonly has_more?: boolean } | null;
  readonly error: unknown;
};

function cursorPage<TSource extends { readonly id: string }, TResult>(
  result: ProviderListResult<TSource>,
  map: (value: TSource) => TResult
): Page<TResult> {
  if (result.error || !result.data || !Array.isArray(result.data.data)) {
    throw new Error("unsupported_inventory");
  }
  const items = result.data.data.map(map);
  const hasMore = result.data.has_more === true;
  const after = hasMore ? result.data.data.at(-1)?.id : undefined;
  if (hasMore && !after) throw new Error("unsupported_inventory");
  return { items, hasMore, after };
}

function providerPage(input: PageInput) {
  return { limit: input.limit, after: input.after };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function listTopicsWithFetch(
  apiKey: string,
  input: PageInput,
  request: typeof fetch
): Promise<Page<SnapshotItem<"topics">>> {
  const url = new URL("https://api.resend.com/topics");
  url.searchParams.set("limit", String(input.limit));
  if (input.after) url.searchParams.set("after", input.after);
  const response = await request(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "user-agent": "official-assembly-newsletter-inventory/1.0"
    },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("unsupported_inventory");
  const body = record(await response.json());
  if (!body || !Array.isArray(body.data)) throw new Error("unsupported_inventory");
  const rawItems = body.data.map(record);
  if (rawItems.some((item) => !item || typeof item.id !== "string")) {
    throw new Error("unsupported_inventory");
  }
  const items = rawItems.map((item) => ({
    id: String(item!.id),
    name: typeof item!.name === "string" ? item!.name : "",
    defaultSubscription:
      typeof item!.default_subscription === "string" ? item!.default_subscription : "",
    visibility: typeof item!.visibility === "string" ? item!.visibility : ""
  }));
  const hasMore = body.has_more === true;
  const after = hasMore ? items.at(-1)?.id : undefined;
  if (hasMore && !after) throw new Error("unsupported_inventory");
  return { items, hasMore, after };
}

export function createProductionNewsletterInventoryReader(input: {
  readonly managementApiKey: string;
  readonly sendApiKey: string;
  readonly segmentId: string;
  readonly request?: typeof fetch;
}): NewsletterProviderInventoryReader {
  const management = new Resend(input.managementApiKey);
  const send = new Resend(input.sendApiKey);
  const request = input.request ?? fetch;
  let nextProviderRequestAt = 0;

  async function providerRequest<T>(operation: () => Promise<T>): Promise<T> {
    const waitMs = Math.max(0, nextProviderRequestAt - Date.now());
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    // Stay below the documented team-wide default while keeping every read
    // deterministic and sequential.
    nextProviderRequestAt = Date.now() + 250;
    return operation();
  }

  return {
    async probeManagementCredential() {
      const result = await providerRequest(() => management.segments.list({ limit: 1 }));
      return result.error || !result.data ? "unavailable" : "authorized";
    },
    async probeSendCredential() {
      const result = await providerRequest(() => send.segments.list({ limit: 1 }));
      if (!result.error && result.data) return "authorized";
      return result.error?.name === "restricted_api_key" ? "restricted" : "unavailable";
    },
    async listApiKeys(page) {
      return cursorPage(await providerRequest(() => management.apiKeys.list(providerPage(page))), (item) => ({
        id: item.id,
        name: item.name
      }));
    },
    async listAutomations(page) {
      return cursorPage(await providerRequest(() => management.automations.list(providerPage(page))), (item) => ({ id: item.id }));
    },
    async listBroadcasts(page) {
      const listed = await providerRequest(() => management.broadcasts.list(providerPage(page)));
      if (listed.error || !listed.data) throw new Error("unsupported_inventory");
      const items: SnapshotItem<"broadcasts">[] = [];
      for (const item of listed.data.data) {
        const detail = await providerRequest(() => management.broadcasts.get(item.id));
        if (detail.error || !detail.data) throw new Error("unsupported_inventory");
        items.push({
          id: detail.data.id,
          status: detail.data.status,
          from: detail.data.from ?? "",
          segmentId: detail.data.segment_id ?? "",
          topicId: detail.data.topic_id ?? ""
        });
      }
      const hasMore = listed.data.has_more;
      const after = hasMore ? listed.data.data.at(-1)?.id : undefined;
      if (hasMore && !after) throw new Error("unsupported_inventory");
      return { items, hasMore, after };
    },
    async listContacts(page) {
      return cursorPage(await providerRequest(() => management.contacts.list(providerPage(page))), (item) => ({
        id: item.id,
        email: item.email
      }));
    },
    async listSegmentContacts(page) {
      return cursorPage(await providerRequest(() => management.contacts.list({
        ...providerPage(page),
        segmentId: input.segmentId
      })), (item) => ({ id: item.id, email: item.email }));
    },
    async listDomains(page) {
      return cursorPage(await providerRequest(() => management.domains.list(providerPage(page))), (item) => ({
        id: item.id,
        name: item.name,
        status: item.status
      }));
    },
    async listEmails(page) {
      return cursorPage(await providerRequest(() => management.emails.list(providerPage(page))), (item) => ({
        id: item.id,
        status: item.last_event
      }));
    },
    async listImports(page) {
      return cursorPage(await providerRequest(() => management.contacts.imports.list(providerPage(page))), (item) => ({ id: item.id }));
    },
    async listOauthGrants(page) {
      return cursorPage(await providerRequest(() => management.oauthGrants.list(providerPage(page))), (item) => ({ id: item.id }));
    },
    async listSegments(page) {
      return cursorPage(await providerRequest(() => management.segments.list(providerPage(page))), (item) => ({
        id: item.id,
        name: item.name
      }));
    },
    async listSuppressions(page) {
      return cursorPage(await providerRequest(() => management.suppressions.list(providerPage(page))), (item) => ({
        id: item.id,
        email: item.email,
        origin: item.origin
      }));
    },
    async listTemplates(page) {
      return cursorPage(await providerRequest(() => management.templates.list(providerPage(page))), (item) => ({ id: item.id }));
    },
    async listTopics(page) {
      return providerRequest(() => listTopicsWithFetch(input.managementApiKey, page, request));
    },
    async listWebhooks(page) {
      return cursorPage(await providerRequest(() => management.webhooks.list(providerPage(page))), (item) => ({
        id: item.id,
        endpoint: item.endpoint,
        status: item.status,
        events: item.events ?? []
      }));
    },
    async listContactProperties(page) {
      return cursorPage(await providerRequest(() => management.contactProperties.list(providerPage(page))), (item) => ({ id: item.id }));
    },
    async listCustomEvents(page) {
      return cursorPage(await providerRequest(() => management.events.list(providerPage(page))), (item) => ({ id: item.id }));
    },
    async listReceivedEmails(page) {
      return cursorPage(await providerRequest(() => management.emails.receiving.list(providerPage(page))), (item) => ({ id: item.id }));
    }
  };
}
