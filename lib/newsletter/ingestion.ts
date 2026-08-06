import "server-only";

import type { TrustedBaseFormSubmissionCommand } from "@reuben-williams/core";
import {
  PublicFormIngestionError,
  createSupabasePublicFormIngestionService,
  type PublicFormIngestionAcceptance,
  type PublicFormIngestionService
} from "@reuben-williams/next/forms/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export interface NewsletterRpcClient {
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

type NewsletterIngestionOptions = {
  readonly confirmationKeyId: string;
};

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function parseAcceptance(value: unknown): PublicFormIngestionAcceptance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicFormIngestionError("INGESTION_UNAVAILABLE");
  }
  const result = value as Record<string, unknown>;
  if (
    result.version !== 2 ||
    result.accepted !== true ||
    typeof result.receiptId !== "string" ||
    !UUID_PATTERN.test(result.receiptId) ||
    !["accepted", "replayed"].includes(String(result.result))
  ) {
    throw new PublicFormIngestionError("INGESTION_UNAVAILABLE");
  }
  return Object.freeze({
    version: 2,
    accepted: true,
    receiptId: result.receiptId,
    result: result.result as "accepted" | "replayed"
  });
}

export function createNewsletterPublicFormIngestionService(
  client: NewsletterRpcClient,
  options: NewsletterIngestionOptions
): PublicFormIngestionService {
  if (!KEY_ID_PATTERN.test(options.confirmationKeyId)) {
    throw new TypeError("Newsletter confirmation key identifier is invalid.");
  }

  return {
    async ingest(command: TrustedBaseFormSubmissionCommand) {
      const identity = command.rateLimits.find((entry) => entry.kind === "identity");
      if (!identity) throw new PublicFormIngestionError("INGESTION_UNAVAILABLE");

      const response = await client.rpc("builder_ingest_official_assembly_newsletter_v1", {
        p_request: {
          version: 1,
          confirmationKeyId: options.confirmationKeyId,
          addressFingerprint: identity.bucketKeyHmac,
          ingestion: command
        }
      });
      if (response.error) {
        const code = databaseErrorCode(response.error);
        if (code === "P2F29") throw new PublicFormIngestionError("RATE_LIMITED", 60);
        if (code === "P2F09" || code === "P2N01") {
          throw new PublicFormIngestionError("REPLAY_CONFLICT");
        }
        throw new PublicFormIngestionError("INGESTION_UNAVAILABLE");
      }
      return parseAcceptance(response.data);
    }
  };
}

export function createManagedPublicFormIngestionService(input: {
  readonly type: "contact" | "newsletter";
  readonly client: NewsletterRpcClient;
  readonly confirmationKeyId: string;
}): PublicFormIngestionService {
  if (input.type === "newsletter") {
    return createNewsletterPublicFormIngestionService(input.client, {
      confirmationKeyId: input.confirmationKeyId
    });
  }
  return createSupabasePublicFormIngestionService(
    input.client as Parameters<typeof createSupabasePublicFormIngestionService>[0],
    { mode: "strict" }
  );
}
