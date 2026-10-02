import { verifyPreviewCsrf } from "@reuben-williams/next/auth";
import {
  assertRequestOrigin,
  BUILDER_SITE_KEY,
  BuilderAuthorizationError,
  type ActiveBuilderIdentity,
} from "../builder/authorization";
import {
  CAROUSEL_UUID,
  canEditCarousel,
  canPublishCarousel,
  validateCarouselDocument,
  type CarouselDocumentV1,
} from "./contract";

export type CarouselCommand = {
  action: "save" | "restore" | "review" | "publish" | "bootstrap";
  expectedVersion: number;
  expectedPublishedId: string | null;
  commandId?: string;
  revisionId?: string;
  document?: CarouselDocumentV1;
  reviewToken?: string;
};
export class CarouselError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function parseCarouselCommand(value: unknown): CarouselCommand {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid carousel command.");
  const v = value as Record<string, unknown>;
  const keys = [
    "action",
    "expectedVersion",
    "expectedPublishedId",
    ...(v.action === "save" || v.action === "bootstrap"
      ? ["commandId", "document"]
      : v.action === "review"
        ? ["revisionId"]
        : v.action === "restore"
          ? ["commandId", "revisionId"]
          : ["commandId", "revisionId", "reviewToken"]),
  ];
  if (
    Object.keys(v).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in v)) ||
    !["save", "restore", "review", "publish", "bootstrap"].includes(
      String(v.action),
    ) ||
    !Number.isSafeInteger(v.expectedVersion) ||
    (v.action === "bootstrap"
      ? v.expectedVersion !== 0 || v.expectedPublishedId !== null
      : Number(v.expectedVersion) < 1 ||
        typeof v.expectedPublishedId !== "string" ||
        !CAROUSEL_UUID.test(v.expectedPublishedId))
  )
    throw new TypeError("Invalid carousel command.");
  for (const key of ["commandId", "revisionId"])
    if (
      key in v &&
      (typeof v[key] !== "string" || !CAROUSEL_UUID.test(v[key] as string))
    )
      throw new TypeError("Invalid revision or command identity.");
  if (v.action === "save" || v.action === "bootstrap")
    validateCarouselDocument(v.document, v.action === "bootstrap");
  if (
    v.action === "publish" &&
    (typeof v.reviewToken !== "string" || v.reviewToken.length > 2048)
  )
    throw new TypeError("Review this saved revision before publishing.");
  return v as CarouselCommand;
}
export interface CarouselService {
  read(identity: ActiveBuilderIdentity): Promise<unknown>;
  execute(
    identity: ActiveBuilderIdentity,
    command: CarouselCommand,
  ): Promise<unknown>;
}
export function createCarouselHandlers(input: {
  authenticate: (request: Request) => Promise<ActiveBuilderIdentity | null>;
  service: CarouselService;
  origins: readonly string[];
}) {
  const response = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { "cache-control": "no-store" } });
  async function handle(request: Request, mutation: boolean) {
    try {
      const identity = await input.authenticate(request);
      if (!identity || identity.tokenGeneration !== identity.sessionGeneration)
        throw new CarouselError(
          401,
          "AUTH_REQUIRED",
          "Your session expired. Sign in in another tab, then retry here to retain your work.",
        );
      if (identity.siteKey !== BUILDER_SITE_KEY)
        throw new CarouselError(
          403,
          "FORBIDDEN",
          "This account cannot access this site.",
        );
      if (!mutation) return response(await input.service.read(identity));
      assertRequestOrigin(request, input.origins);
      try {
        verifyPreviewCsrf(
          identity.csrfToken ?? "",
          request.headers.get("x-builder-csrf"),
        );
      } catch {
        throw new CarouselError(
          403,
          "CSRF_REJECTED",
          "Refresh your sign-in before trying again.",
        );
      }
      if (!canEditCarousel(identity.role))
        throw new CarouselError(
          403,
          "FORBIDDEN",
          "This account has read-only access.",
        );
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new TypeError("Use a JSON request.");
      const reader = request.body?.getReader();
      if (!reader) throw new TypeError("Missing command.");
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          throw new TypeError("Carousel command is too large.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const command = parseCarouselCommand(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      if (command.action === "bootstrap" && identity.role !== "owner")
        throw new CarouselError(
          403,
          "FORBIDDEN",
          "Only the site owner can initialize the approved carousel.",
        );
      if (command.action === "publish" && !canPublishCarousel(identity.role))
        throw new CarouselError(
          403,
          "FORBIDDEN",
          "An editor or owner must publish this draft.",
        );
      return response(await input.service.execute(identity, command));
    } catch (error) {
      if (
        error instanceof CarouselError ||
        error instanceof BuilderAuthorizationError
      )
        return response(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      if (error instanceof TypeError || error instanceof SyntaxError)
        return response(
          { error: { code: "VALIDATION", message: error.message } },
          400,
        );
      // Never log provider URLs, content, tokens, or raw exception messages.
      const message = error instanceof Error ? error.message : "";
      const codes = ["INCOMPLETE_ROUTES", "GENERATION_IDENTITY_MISMATCH", "MEDIA_DIGEST_MISMATCH", "INVALID_ARTIFACT", "IMMUTABLE_CONFLICT", "POINTER_CONFLICT", "EVENTS_BASELINE_READ_FAILED"];
      const code = codes.find((candidate) => message === candidate)
        ?? (/already exists/i.test(message) ? "BLOB_EXISTS"
          : /too many requests/i.test(message) ? "PROVIDER_RATE_LIMIT"
          : /access denied|not authorized|forbidden/i.test(message) ? "PROVIDER_ACCESS"
          : "UNEXPECTED_STORAGE_ERROR");
      console.error("carousel_operation_failed", { code });
      return response(
        {
          error: {
            code: "UNAVAILABLE",
            message:
              "Carousel changes could not be confirmed. Your work is still here; retry the same action.",
          },
        },
        503,
      );
    }
  }
  return {
    GET: (request: Request) => handle(request, false),
    POST: (request: Request) => handle(request, true),
  };
}
