import "server-only";

export interface ConfirmationRpcClient {
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

function status(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof (value as Record<string, unknown>).status === "string"
    ? String((value as Record<string, unknown>).status)
    : null;
}

export function createNewsletterConfirmationRepository(client: ConfirmationRpcClient) {
  return {
    async exchange(input: {
      readonly siteId: string;
      readonly subscriptionId: string;
      readonly generation: number;
      readonly nonce: string;
      readonly keyId: string;
      readonly sessionDigest: string;
      readonly sessionExpiresAt: string;
    }) {
      const result = await client.rpc("builder_exchange_newsletter_confirmation_session_v1", {
        p_request: {
          version: 1,
          siteId: input.siteId,
          subscriptionId: input.subscriptionId,
          generation: input.generation,
          nonce: input.nonce,
          keyId: input.keyId,
          sessionDigest: input.sessionDigest,
          sessionExpiresAt: input.sessionExpiresAt
        }
      });
      if (result.error || status(result.data) !== "ready") throw new Error("confirmation unavailable");
      return { status: "ready" as const };
    },

    async confirm(input: { readonly siteId: string; readonly sessionDigest: string }) {
      const result = await client.rpc("builder_confirm_newsletter_subscription_v1", {
        p_request: { version: 1, siteId: input.siteId, sessionDigest: input.sessionDigest }
      });
      const state = status(result.data);
      if (result.error || !["confirmed_pending_provider", "already_confirmed"].includes(state ?? "")) {
        throw new Error("confirmation unavailable");
      }
      return { status: state as "confirmed_pending_provider" | "already_confirmed" };
    }
  };
}
