import "server-only";

import {
  inspectLocalizedDomainReadinessV1,
  sha256Json,
  type LocalizedDomainRevisionV1,
  type LocalizedDomainV1,
} from "@reuben-williams/content";
import {
  createSupabaseBilingualPublicationRepository,
  type ActivateBilingualPublishingRequestV1,
  type BilingualPublicationServerRepository,
  type PublishSiteCompositionRequestV1,
  type RestoreSiteCompositionRequestV1,
  type StageDomainCompositionRequestV1,
} from "@reuben-williams/next/content/server";
import { canBuilderRole } from "@reuben-williams/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BuilderAuthorizationError,
  BUILDER_SITE_KEY,
  assertRequestOrigin,
  type ActiveBuilderIdentity,
} from "../authorization";
import { verifyPreviewCsrf } from "@reuben-williams/next/auth";
import {
  domainReadCapability,
  domainEditCapability,
  domainPublishCapability,
  reviseSpanishLocalization,
  roleCanPerformBilingualOperation,
  type BilingualEditorOperation,
  type SpanishRevisionOperation,
} from "./index";

type AuthenticateBilingualRequest = (request: Request) => Promise<ActiveBuilderIdentity | null>;

export interface BilingualWorkspaceData {
  readonly revisions: readonly unknown[];
  readonly published: unknown | null;
  readonly publications: readonly unknown[];
  readonly candidates: readonly unknown[];
  readonly publicationState: unknown | null;
  readonly recoveryPointer: unknown | null;
  readonly blockers: readonly unknown[];
}

export interface TranslationMutationInput {
  readonly siteId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly operation: SpanishRevisionOperation;
  readonly domain: LocalizedDomainV1;
  readonly stableId: string;
  readonly fieldId: string;
  readonly spanish?: string;
}

export interface CompositionCommandInput {
  readonly siteId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly [key: string]: unknown;
}

export interface BilingualEditorRepository {
  readWorkspace(siteId: string): Promise<BilingualWorkspaceData>;
  readRevisionDomain(siteId: string, revisionId: string): Promise<LocalizedDomainV1 | null>;
  readCompositionDeltaDomain(siteId: string, compositionId: string): Promise<LocalizedDomainV1 | "restore" | null>;
  mutateTranslation(input: TranslationMutationInput): Promise<unknown>;
  stage(input: CompositionCommandInput): Promise<unknown>;
  publish(input: CompositionCommandInput): Promise<unknown>;
  restore(input: CompositionCommandInput): Promise<unknown>;
  activate(input: CompositionCommandInput): Promise<unknown>;
}

const DOMAINS = new Set<LocalizedDomainV1>(["site", "post", "alerts", "form", "media", "email"]);
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9:._-]{8,200}$/;

function response(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

class BilingualIdempotencyError extends Error {
  constructor() {
    super("The idempotency key was already used for a different localization request.");
    this.name = "BilingualIdempotencyError";
  }
}

function errorResponse(error: unknown) {
  if (error instanceof BuilderAuthorizationError) {
    return response({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof BilingualIdempotencyError) {
    return response({ error: { code: "IDEMPOTENCY_MISMATCH", message: error.message } }, 409);
  }
  if (error instanceof TypeError || error instanceof SyntaxError) {
    return response({ error: { code: "INVALID_LOCALIZATION_REQUEST", message: error.message } }, 400);
  }
  const candidate = error as { code?: string; message?: string };
  if (["STALE_COMPOSITION", "40001"].includes(String(candidate.code))) {
    return response({ error: { code: "STALE_COMPOSITION", message: "The published site changed. Refresh and try again." } }, 409);
  }
  if (["LOCALIZATION_NOT_READY", "23514"].includes(String(candidate.code))) {
    return response({ error: { code: "LOCALIZATION_NOT_READY", message: "Required Spanish content is not approved yet." } }, 409);
  }
  if (["PUBLICATION_PERMISSION_DENIED", "42501"].includes(String(candidate.code))) {
    return response({ error: { code: "ROLE_DENIED", message: "This account cannot perform that bilingual action." } }, 403);
  }
  return response({ error: { code: "LOCALIZATION_UNAVAILABLE", message: "The bilingual publishing service is unavailable." } }, 503);
}

async function body(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new TypeError("A JSON localization request is required.");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > 262_144) throw new TypeError("The localization request is too large.");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("The localization request is invalid.");
  return value as Record<string, unknown>;
}

function idempotencyKey(request: Request) {
  const key = request.headers.get("x-idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY.test(key)) throw new TypeError("A valid idempotency key is required.");
  return key;
}

function operation(value: unknown): BilingualEditorOperation {
  if (!["save_draft", "submit_review", "approve", "stage", "publish", "restore", "activate"].includes(String(value))) {
    throw new TypeError("The bilingual operation is invalid.");
  }
  return value as BilingualEditorOperation;
}

async function trustedIdentity(
  request: Request,
  authenticate: AuthenticateBilingualRequest,
): Promise<ActiveBuilderIdentity> {
  const identity = await authenticate(request);
  if (!identity) throw new BuilderAuthorizationError("AUTH_REQUIRED", 401, "A verified editor session is required.");
  if (identity.siteKey !== BUILDER_SITE_KEY) {
    throw new BuilderAuthorizationError("SITE_ACCESS_DENIED", 403, "This account cannot access this site.");
  }
  if (identity.sessionGeneration !== identity.tokenGeneration) {
    throw new BuilderAuthorizationError("AUTH_SESSION_REVOKED", 401, "The editor session is no longer active.");
  }
  return identity;
}

function requireCapability(identity: ActiveBuilderIdentity, selectedOperation: BilingualEditorOperation) {
  if (!roleCanPerformBilingualOperation(identity.role, selectedOperation)) {
    throw new BuilderAuthorizationError("ROLE_DENIED", 403, "This account cannot perform that bilingual action.");
  }
}

function string(value: unknown, label: string, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new TypeError(`${label} is invalid.`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new TypeError(`${label} is invalid.`);
  return value as number;
}

function digest(value: unknown, label: string) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function uuidArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 1_000) throw new TypeError(`${label} is invalid.`);
  return value.map((item) => uuid(item, label));
}

function stringRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) throw new TypeError(`${label} is invalid.`);
  return Object.fromEntries(entries.map(([key, item]) => [
    string(key, label, 200),
    string(item, label, 200),
  ]));
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError(`${label} is invalid.`);
  return value.map((item) => string(item, label, 500));
}

function readableDomain(role: ActiveBuilderIdentity["role"], value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const domain = (value as Record<string, unknown>).domain as LocalizedDomainV1 | undefined;
  return Boolean(domain && DOMAINS.has(domain) && canBuilderRole(role, domainReadCapability(domain)));
}

function readableCandidate(role: ActiveBuilderIdentity["role"], value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const intended = (value as Record<string, unknown>).intended_delta;
  if (!intended || typeof intended !== "object" || Array.isArray(intended)) return false;
  const delta = intended as Record<string, unknown>;
  if (delta.kind === "restore") return canBuilderRole(role, "post.rollback");
  const domain = delta.domain as LocalizedDomainV1 | undefined;
  return Boolean(domain && DOMAINS.has(domain) && canBuilderRole(role, domainReadCapability(domain)));
}

function replayMatchesTranslationInput(snapshot: unknown, input: TranslationMutationInput) {
  try {
    const revision = record(snapshot) as unknown as LocalizedDomainRevisionV1;
    if (revision.siteId !== input.siteId || revision.domain !== input.domain ||
        revision.stableId !== input.stableId || revision.createdBy !== input.actorId) return false;
    const field = revision.fields.find((candidate) =>
      candidate.kind === "text" && candidate.value.fieldId === input.fieldId);
    if (!field || field.kind !== "text" || field.value.es.mode !== "translated") return false;
    if (input.operation === "save_draft") {
      return field.value.es.status === "draft" && field.value.es.value === input.spanish;
    }
    return field.value.es.status === (input.operation === "submit_review" ? "needs_review" : "approved");
  } catch {
    return false;
  }
}

async function revisionIdForIdempotencyKey(key: string) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  hash[6] = (hash[6]! & 0x0f) | 0x40;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const value = [...hash.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function createBilingualEditorHandlers(input: {
  readonly repository: BilingualEditorRepository;
  readonly authenticate: AuthenticateBilingualRequest;
  readonly allowedOrigins: readonly string[];
}) {
  return Object.freeze({
    async GET(request: Request) {
      try {
        const identity = await trustedIdentity(request, input.authenticate);
        requireCapability(identity, "read");
        const workspace = await input.repository.readWorkspace(identity.siteId);
        return response({
          ...workspace,
          revisions: workspace.revisions.filter((revision) => readableDomain(identity.role, revision)),
          blockers: workspace.blockers.filter((blocker) => readableDomain(identity.role, blocker)),
          candidates: (workspace.candidates ?? []).filter((candidate) => readableCandidate(identity.role, candidate)),
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
    async POST(request: Request) {
      try {
        assertRequestOrigin(request, input.allowedOrigins);
        const identity = await trustedIdentity(request, input.authenticate);
        try {
          verifyPreviewCsrf(identity.csrfToken ?? "", request.headers.get("x-builder-csrf"));
        } catch {
          throw new BuilderAuthorizationError("CSRF_REJECTED", 403, "The request could not be verified.");
        }
        const value = await body(request);
        const selectedOperation = operation(value.operation);
        requireCapability(identity, selectedOperation);
        const key = idempotencyKey(request);

        if (["save_draft", "submit_review", "approve"].includes(selectedOperation)) {
          const domain = value.domain as LocalizedDomainV1;
          if (!DOMAINS.has(domain)) throw new TypeError("Localization domain is invalid.");
          if (!canBuilderRole(identity.role, domainEditCapability(domain))) {
            throw new BuilderAuthorizationError("ROLE_DENIED", 403, "This account cannot edit that bilingual content domain.");
          }
          const result = await input.repository.mutateTranslation({
            siteId: identity.siteId,
            actorId: identity.userId,
            idempotencyKey: key,
            operation: selectedOperation as SpanishRevisionOperation,
            domain,
            stableId: string(value.stableId, "Localization stable ID"),
            fieldId: string(value.fieldId, "Localization field ID"),
            ...(selectedOperation === "save_draft"
              ? { spanish: string(value.spanish, "Spanish translation", 100_000) }
              : {}),
          });
          return response(result);
        }

        if (selectedOperation === "stage") {
          const candidateRevisionId = string(value.candidateRevisionId, "Candidate revision ID");
          const domain = await input.repository.readRevisionDomain(identity.siteId, candidateRevisionId);
          if (!domain || !canBuilderRole(identity.role, domainEditCapability(domain))) {
            throw new BuilderAuthorizationError("ROLE_DENIED", 403, "This account cannot stage that bilingual content domain.");
          }
          return response(await input.repository.stage({
            siteId: identity.siteId,
            actorId: identity.userId,
            idempotencyKey: key,
            expectedLockVersion: integer(value.expectedLockVersion, "Expected lock version"),
            expectedCurrentCompositionId: value.expectedCurrentCompositionId === null ? null : uuid(value.expectedCurrentCompositionId, "Current composition ID"),
            candidateRevisionId: uuid(candidateRevisionId, "Candidate revision ID"),
            dependencyRevisionIds: uuidArray(value.dependencyRevisionIds ?? [], "Dependency revision IDs"),
            ...(value.globalRegionRevisionId ? { globalRegionRevisionId: uuid(value.globalRegionRevisionId, "Global revision ID") } : {}),
            ...(value.catalogRevision ? { catalogRevision: string(value.catalogRevision, "Catalog revision") } : {}),
            ...(value.catalogPublicDigest ? { catalogPublicDigest: digest(value.catalogPublicDigest, "Catalog public digest") } : {}),
          }));
        }
        if (selectedOperation === "publish") {
          const candidateCompositionId = string(value.candidateCompositionId, "Candidate composition ID");
          const domain = await input.repository.readCompositionDeltaDomain(identity.siteId, candidateCompositionId);
          const allowed = domain === "restore"
            ? canBuilderRole(identity.role, "post.rollback")
            : Boolean(domain && canBuilderRole(identity.role, domainPublishCapability(domain)));
          if (!allowed) {
            throw new BuilderAuthorizationError("ROLE_DENIED", 403, "This account cannot publish that bilingual content domain.");
          }
          return response(await input.repository.publish({
            siteId: identity.siteId,
            actorId: identity.userId,
            idempotencyKey: key,
            expectedLockVersion: integer(value.expectedLockVersion, "Expected lock version"),
            expectedCurrentCompositionId: value.expectedCurrentCompositionId === null ? null : uuid(value.expectedCurrentCompositionId, "Current composition ID"),
            candidateCompositionId: uuid(candidateCompositionId, "Candidate composition ID"),
            candidateCompositionDigest: digest(value.candidateCompositionDigest, "Candidate composition digest"),
          }));
        }
        if (selectedOperation === "restore") {
          return response(await input.repository.restore({
            siteId: identity.siteId,
            actorId: identity.userId,
            idempotencyKey: key,
            expectedLockVersion: integer(value.expectedLockVersion, "Expected lock version"),
            expectedCurrentCompositionId: uuid(value.expectedCurrentCompositionId, "Current composition ID"),
            targetCompositionId: uuid(value.targetCompositionId, "Target composition ID"),
          }));
        }
        return response(await input.repository.activate({
          siteId: identity.siteId,
          actorId: identity.userId,
          idempotencyKey: key,
          expectedLockVersion: integer(value.expectedLockVersion, "Expected lock version"),
          expectedCompositionDigest: digest(value.expectedCompositionDigest, "Expected composition digest"),
          expectedCatalogPublicDigest: digest(value.expectedCatalogPublicDigest, "Expected catalog digest"),
          inventoryDigest: digest(value.inventoryDigest, "Inventory digest"),
          applicationRelease: string(value.applicationRelease, "Application release", 200),
          packageVersions: stringRecord(value.packageVersions, "Package versions"),
          migrationSet: stringArray(value.migrationSet, "Migration set"),
        }));
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
}

type RevisionRow = {
  revision_id: string;
  snapshot: unknown;
  snapshot_digest: string;
  bilingual_ready: boolean;
  created_at: string;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Localization record is invalid.");
  return value as Record<string, unknown>;
}

function publicationRequest<T extends object>(input: CompositionCommandInput): T {
  const { siteId: _siteId, ...request } = input;
  return request as T;
}

export function createSupabaseBilingualEditorRepository(client: SupabaseClient): BilingualEditorRepository {
  const publication: BilingualPublicationServerRepository = createSupabaseBilingualPublicationRepository(client);
  return Object.freeze({
    async readWorkspace(siteId: string) {
      const [revisionResult, publicationResult, candidateResult, stateResult, recoveryResult, published] = await Promise.all([
        client.from("builder_localized_domain_revisions")
          .select("revision_id, domain, stable_id, snapshot, snapshot_digest, bilingual_ready, created_at")
          .eq("site_id", siteId)
          .order("created_at", { ascending: false })
          .order("revision_id", { ascending: false }),
        client.from("builder_site_composition_publications")
          .select("publication_sequence, composition_id, composition_digest, predecessor_composition_id, published_at")
          .eq("site_id", siteId)
          .order("publication_sequence", { ascending: false })
          .limit(100),
        client.from("builder_site_compositions")
          .select("composition_id, composition_digest, base_composition_id, intended_delta, created_at")
          .eq("site_id", siteId)
          .not("base_composition_id", "is", null)
          .order("created_at", { ascending: false })
          .order("composition_id", { ascending: false })
          .limit(20),
        client.from("builder_site_publication_state")
          .select("published_composition_id, published_sequence, bilingual_active, lock_version, updated_at")
          .eq("site_id", siteId)
          .maybeSingle(),
        client.from("builder_site_composition_recovery_pointer")
          .select("publication_sequence, composition_id, composition_digest, artifact_digest, updated_at")
          .eq("site_id", siteId)
          .maybeSingle(),
        publication.readPublished(siteId),
      ]);
      if (revisionResult.error) throw revisionResult.error;
      if (publicationResult.error) throw publicationResult.error;
      if (candidateResult.error) throw candidateResult.error;
      if (stateResult.error) throw stateResult.error;
      if (recoveryResult.error) throw recoveryResult.error;
      const seen = new Set<string>();
      const currentRevisions = (revisionResult.data ?? []).filter((row) => {
        const key = `${row.domain}:${row.stable_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const readiness = await Promise.all(currentRevisions.map((row) => (
        inspectLocalizedDomainReadinessV1(record(row.snapshot) as unknown as LocalizedDomainRevisionV1)
      )));
      const publishedCompositionIds = new Set((publicationResult.data ?? []).map((row) => row.composition_id));
      const liveCompositionId = stateResult.data?.published_composition_id ?? null;
      const candidates = (candidateResult.data ?? []).filter((row) =>
        row.base_composition_id === liveCompositionId && !publishedCompositionIds.has(row.composition_id));
      return {
        revisions: currentRevisions,
        published,
        publications: publicationResult.data ?? [],
        candidates,
        publicationState: stateResult.data,
        recoveryPointer: recoveryResult.data,
        blockers: readiness.flatMap((result) => result.blockers),
      };
    },
    async mutateTranslation(input: TranslationMutationInput) {
      const revisionId = await revisionIdForIdempotencyKey(input.idempotencyKey);
      const replayResult = await client.from("builder_localized_domain_revisions")
        .select("revision_id, domain, stable_id, snapshot, snapshot_digest, bilingual_ready, created_at")
        .eq("site_id", input.siteId)
        .eq("revision_id", revisionId)
        .maybeSingle();
      if (replayResult.error) throw replayResult.error;
      if (replayResult.data) {
        if (!replayMatchesTranslationInput(replayResult.data.snapshot, input)) {
          throw new BilingualIdempotencyError();
        }
        return replayResult.data;
      }
      const currentResult = await client.from("builder_localized_domain_revisions")
        .select("revision_id, snapshot, snapshot_digest, bilingual_ready, created_at")
        .eq("site_id", input.siteId)
        .eq("domain", input.domain)
        .eq("stable_id", input.stableId)
        .order("created_at", { ascending: false })
        .order("revision_id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (currentResult.error) throw currentResult.error;
      if (!currentResult.data) throw new TypeError("This localization item has not been imported into the live revision store.");
      const row = currentResult.data as RevisionRow;
      const current = record(row.snapshot) as unknown as LocalizedDomainRevisionV1;
      const revision = await reviseSpanishLocalization(current, {
        operation: input.operation,
        fieldId: input.fieldId,
        ...(input.spanish ? { spanish: input.spanish } : {}),
        actorId: input.actorId,
        revisionId,
        createdAt: new Date().toISOString(),
      });
      const snapshotDigest = await sha256Json(revision);
      const saved = await client.from("builder_localized_domain_revisions").insert({
        site_id: input.siteId,
        domain: revision.domain,
        stable_id: revision.stableId,
        revision_id: revision.revisionId,
        parent_revision_id: revision.parentRevisionId,
        snapshot: revision,
        snapshot_digest: snapshotDigest,
        bilingual_ready: false,
        created_by: input.actorId,
        created_at: revision.createdAt,
      }).select("revision_id, domain, stable_id, snapshot, snapshot_digest, bilingual_ready, created_at").single();
      if (saved.error?.code === "23505") {
        const replay = await client.from("builder_localized_domain_revisions")
          .select("revision_id, domain, stable_id, snapshot, snapshot_digest, bilingual_ready, created_at")
          .eq("site_id", input.siteId)
          .eq("revision_id", revisionId)
          .single();
        if (replay.error) throw replay.error;
        if (!replayMatchesTranslationInput(replay.data.snapshot, input)) {
          throw new BilingualIdempotencyError();
        }
        return replay.data;
      }
      if (saved.error) throw saved.error;
      return saved.data;
    },
    async readRevisionDomain(siteId: string, revisionId: string) {
      const result = await client.from("builder_localized_domain_revisions")
        .select("domain")
        .eq("site_id", siteId)
        .eq("revision_id", revisionId)
        .maybeSingle();
      if (result.error) throw result.error;
      const domain = result.data?.domain as LocalizedDomainV1 | undefined;
      return domain && DOMAINS.has(domain) ? domain : null;
    },
    async readCompositionDeltaDomain(siteId: string, compositionId: string) {
      const result = await client.from("builder_site_compositions")
        .select("intended_delta")
        .eq("site_id", siteId)
        .eq("composition_id", compositionId)
        .maybeSingle();
      if (result.error) throw result.error;
      const intended = result.data?.intended_delta;
      if (!intended || typeof intended !== "object" || Array.isArray(intended)) return null;
      const delta = intended as Record<string, unknown>;
      if (delta.kind === "restore") return "restore";
      const domain = delta.domain as LocalizedDomainV1 | undefined;
      return domain && DOMAINS.has(domain) ? domain : null;
    },
    stage(input: CompositionCommandInput) {
      return publication.stageDomain(input.siteId, publicationRequest<StageDomainCompositionRequestV1>(input));
    },
    publish(input: CompositionCommandInput) {
      return publication.publish(input.siteId, publicationRequest<PublishSiteCompositionRequestV1>(input));
    },
    restore(input: CompositionCommandInput) {
      return publication.restore(input.siteId, publicationRequest<RestoreSiteCompositionRequestV1>(input));
    },
    activate(input: CompositionCommandInput) {
      return publication.activate(input.siteId, publicationRequest<ActivateBilingualPublishingRequestV1>(input));
    },
  });
}
