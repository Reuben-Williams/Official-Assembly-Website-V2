import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import site from "../../builder.config";
import type { ActiveBuilderIdentity } from "../builder/authorization";
import {
  canonicalRecoveryJson,
  recoveryDigest,
  createRecoveryArtifactStore,
  createVercelBlobObjectStore,
} from "../builder/recovery/blob-store";
import { createSupabaseRecoveryWorkerRepository } from "../builder/recovery/repository";
import { prepareRecoveryGeneration } from "../builder/recovery/worker";
import { readRecoveryConfiguration } from "../builder/recovery/runtime";
import {
  CarouselError,
  type CarouselCommand,
  type CarouselService,
} from "./handlers";
import {
  carouselDiff,
  createCarouselBaseline,
  validateCarouselDocument,
  type CarouselDocumentV1,
  type CarouselProjection,
} from "./contract";

export type CarouselRevision = {
  id: string;
  document: CarouselDocumentV1;
  createdAt: string;
};
export type CarouselHistory = {
  id: string;
  actor_id?: string;
  action: string;
  result_revision_id: string;
  created_at: string;
  changes: ReturnType<typeof carouselDiff>;
};
export type CarouselState = {
  version: number;
  published: CarouselRevision;
  draft: CarouselRevision;
  projection: CarouselProjection;
  history: CarouselHistory[];
};
export type CarouselReview = {
  token: string;
  revisionId: string;
  projection: CarouselProjection;
  changes: ReturnType<typeof carouselDiff>;
  expiresAt: number;
};
function fail(error: unknown): never {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "";
  if (/STALE|CONFLICT/.test(message))
    throw new CarouselError(
      409,
      "CONFLICT",
      "Someone changed this carousel or another page. Compare the latest saved version before retrying.",
    );
  if (/FORBIDDEN|DENIED/.test(message))
    throw new CarouselError(
      403,
      "FORBIDDEN",
      "This account or image cannot be used for that action.",
    );
  if (/INVALID|ENTRY_ID/.test(message))
    throw new TypeError("Review the carousel fields and translations.");
  throw new CarouselError(
    503,
    "UNAVAILABLE",
    "Carousel storage or verified image backups are unavailable. Nothing new has been confirmed as published.",
  );
}
async function revision(
  client: SupabaseClient,
  siteId: string,
  id: string,
): Promise<CarouselRevision> {
  const { data, error } = await client
    .from("builder_carousel_revisions")
    .select("id,document,created_at")
    .eq("site_id", siteId)
    .eq("id", id)
    .single();
  if (error || !data) fail(error);
  return {
    id: String(data.id),
    document: validateCarouselDocument(data.document),
    createdAt: String(data.created_at),
  };
}
export async function carouselProjection(
  client: SupabaseClient,
  siteId: string,
  saved: CarouselRevision,
  publication = false,
  imageRevisionId?: string,
): Promise<CarouselProjection> {
  const document = validateCarouselDocument(saved.document, publication);
  const refs = [
    ...new Map(
      document.entries.map((entry) => [entry.media.revisionId, entry.media]),
    ).values(),
  ].filter((ref) => !imageRevisionId || ref.revisionId === imageRevisionId);
  if (!refs.length) return { revisionId: saved.id, document, images: [] };
  const [media, replicas] = await Promise.all([
    client
      .from("builder_media_revisions")
      .select("id,media_id,object_key,width,height")
      .eq("site_id", siteId)
      .in(
        "id",
        refs.map((ref) => ref.revisionId),
      ),
    client
      .from("builder_media_recovery_replicas")
      .select("revision_id,status")
      .eq("site_id", siteId)
      .in(
        "revision_id",
        refs.map((ref) => ref.revisionId),
      ),
  ]);
  if (media.error || replicas.error) fail(media.error ?? replicas.error);
  const images = await Promise.all(
    refs.map(async (ref) => {
      const row = media.data?.find(
        (row) => row.id === ref.revisionId && row.media_id === ref.mediaId,
      );
      if (!row) fail(null);
      const ready =
        replicas.data?.some(
          (replica) =>
            replica.revision_id === ref.revisionId &&
            replica.status === "ready",
        ) ?? false;
      if (publication && !ready) fail(null);
      const signed = await client.storage
        .from("builder-media")
        .createSignedUrl(row.object_key, 3600);
      if (signed.error || !signed.data?.signedUrl) fail(signed.error);
      return {
        ...ref,
        url: signed.data.signedUrl,
        width: Number(row.width),
        height: Number(row.height),
        ready,
      };
    }),
  );
  return { revisionId: saved.id, document, images };
}
export async function readCarouselState(
  client: SupabaseClient,
  siteId: string,
): Promise<CarouselState> {
  const { data, error } = await client
    .from("builder_carousels")
    .select("*")
    .eq("site_id", siteId)
    .maybeSingle();
  if (error) fail(error);
  if (!data)
    throw new CarouselError(
      409,
      "NOT_INITIALIZED",
      "The owner must first import and verify the existing eight-photo carousel.",
    );
  if (!data.enabled) fail(null);
  const [draft, published, history] = await Promise.all([
    revision(client, siteId, data.draft_revision_id),
    revision(client, siteId, data.published_revision_id),
    client
      .from("builder_carousel_audit")
      .select("id,actor_id,action,result_revision_id,created_at,changes")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (history.error) fail(history.error);
  return {
    version: Number(data.version),
    draft,
    published,
    projection: await carouselProjection(client, siteId, draft),
    history: (history.data ?? []) as CarouselHistory[],
  };
}
function signature(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update("carousel-review-v1:" + payload)
    .digest("base64url");
}
function seal(claims: object, secret: string) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return payload + "." + signature(payload, secret);
}
function open(token: string, secret: string): Record<string, unknown> {
  const [payload, mac, ...extra] = token.split(".");
  const expected = signature(payload ?? "", secret);
  const a = Buffer.from(mac ?? ""),
    b = Buffer.from(expected);
  if (extra.length || a.length !== b.length || !timingSafeEqual(a, b))
    throw new TypeError("Review this saved draft again before publishing.");
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}
export function createCarouselService(client: SupabaseClient): CarouselService {
  return {
    read: (identity) => readCarouselState(client, identity.siteId),
    async execute(identity: ActiveBuilderIdentity, command: CarouselCommand) {
      const digest = await recoveryDigest(
        new TextEncoder().encode(canonicalRecoveryJson(command)),
      );
      const config = readRecoveryConfiguration();
      const artifacts = createRecoveryArtifactStore({
        objects: createVercelBlobObjectStore({ token: config.blobToken }),
        environment: config.environment,
        siteKey: identity.siteKey,
      });
      // Receipt recovery happens before stale-version checks, but only for this verified actor and exact payload.
      if (command.commandId) {
        const receipt = await client
          .from("builder_carousel_commands")
          .select("actor_id,payload_digest,result")
          .eq("site_id", identity.siteId)
          .eq("command_id", command.commandId)
          .maybeSingle();
        if (receipt.error) fail(receipt.error);
        if (receipt.data) {
          if (
            receipt.data.actor_id !== identity.userId ||
            receipt.data.payload_digest !== digest
          )
            fail({ message: "CONFLICT" });
          const confirmed = await client.rpc("builder_carousel_command_v1", {
            p_site_id: identity.siteId,
            p_actor_id: identity.userId,
            p_generation: identity.sessionGeneration,
            p_command: { ...command, digest },
          });
          if (confirmed.error) fail(confirmed.error);
          if (command.action === "publish" || command.action === "bootstrap")
            await artifacts.advanceLatest(confirmed.data.prepared.pointer);
          return {
            state: await readCarouselState(client, identity.siteId),
            result: confirmed.data,
          };
        }
      }
      let state: CarouselState;
      if (command.action === "bootstrap") {
        if (identity.role !== "owner") fail({ message: "FORBIDDEN" });
        const baseline = createCarouselBaseline(
          command.document!.entries.map((entry) => entry.media),
        );
        if (
          canonicalRecoveryJson(baseline) !==
          canonicalRecoveryJson(command.document)
        )
          throw new TypeError(
            "Initialization must preserve the approved eight-photo baseline.",
          );
        const staged = await client.rpc("builder_stage_carousel_baseline_v1", {
          p_site_id: identity.siteId,
          p_actor_id: identity.userId,
          p_generation: identity.sessionGeneration,
          p_revision_id: command.commandId,
          p_document: baseline,
        });
        if (staged.error) fail(staged.error);
        const saved = await revision(
          client,
          identity.siteId,
          command.commandId!,
        );
        state = {
          version: 0,
          draft: saved,
          published: saved,
          history: [],
          projection: await carouselProjection(
            client,
            identity.siteId,
            saved,
            true,
          ),
        };
      } else state = await readCarouselState(client, identity.siteId);
      if (
        state.version !== command.expectedVersion ||
        (command.action !== "bootstrap" &&
          state.published.id !== command.expectedPublishedId)
      )
        fail({ message: "STALE" });
      if (command.action === "review") {
        if (command.revisionId !== state.draft.id)
          fail({ message: "STALE_REVIEW" });
        const projection = await carouselProjection(
          client,
          identity.siteId,
          state.draft,
          true,
        );
        const expiresAt = Date.now() + 10 * 60 * 1000;
        const token = seal(
          {
            site: identity.siteId,
            actor: identity.userId,
            version: state.version,
            revision: state.draft.id,
            published: state.published.id,
            expiresAt,
          },
          config.grantSecret,
        );
        return {
          review: {
            token,
            revisionId: state.draft.id,
            projection,
            changes: carouselDiff(
              state.published.document,
              state.draft.document,
            ),
            expiresAt,
          } satisfies CarouselReview,
        };
      }
      let document =
        command.action === "save"
          ? command.document!
          : command.action === "restore"
            ? (await revision(client, identity.siteId, command.revisionId!))
                .document
            : state.draft.document;
      document = validateCarouselDocument(
        document,
        command.action === "publish" || command.action === "bootstrap",
      );
      let prepared: Record<string, unknown> | undefined;
      if (command.action === "publish") {
        const claims = open(command.reviewToken!, config.grantSecret);
        if (
          claims.site !== identity.siteId ||
          claims.actor !== identity.userId ||
          claims.version !== state.version ||
          claims.revision !== state.draft.id ||
          claims.published !== state.published.id ||
          Number(claims.expiresAt) < Date.now() ||
          command.revisionId !== state.draft.id
        )
          throw new TypeError(
            "This review expired or the draft changed. Review it again.",
          );
      }
      if (command.action === "publish" || command.action === "bootstrap") {
        const latest = await client
          .from("builder_site_generations")
          .select("generation_id")
          .eq("site_id", identity.siteId)
          .order("generation_id", { ascending: false })
          .limit(1)
          .single();
        if (latest.error || !latest.data) fail(latest.error);
        const baseGeneration = Number(latest.data.generation_id);
        const repository = createSupabaseRecoveryWorkerRepository(client, {
          carouselRevisionId: state.draft.id,
        });
        const source = await repository.loadGeneration({
          siteId: identity.siteId,
          generationId: baseGeneration,
          fenceToken: 1,
        });
        const createdAt = new Date().toISOString();
        const pointer = await prepareRecoveryGeneration({
          source: {
            ...source,
            generationId: baseGeneration + 1,
            commandId: command.commandId!,
            createdAt,
          },
          environment: config.environment,
          configuredRoutes: site.pages.map((page) => page.path),
          artifacts,
        });
        prepared = {
          ...pointer,
          pointer,
          baseGeneration,
          globalVersionId: source.global.versionId,
          pageVersions: Object.fromEntries(
            source.pages.map((page) => [page.path, page.versionId]),
          ),
          createdAt,
        };
      }
      const changes = carouselDiff(
        command.action === "publish"
          ? state.published.document
          : state.draft.document,
        document,
      );
      const rpc = await client.rpc("builder_carousel_command_v1", {
        p_site_id: identity.siteId,
        p_actor_id: identity.userId,
        p_generation: identity.sessionGeneration,
        p_command: {
          ...command,
          digest,
          changes,
          ...(prepared ? { prepared } : {}),
        },
      });
      if (rpc.error) fail(rpc.error);
      if (command.action === "publish" || command.action === "bootstrap")
        await artifacts.advanceLatest(rpc.data.prepared.pointer);
      return {
        state: await readCarouselState(client, identity.siteId),
        result: rpc.data,
      };
    },
  };
}
