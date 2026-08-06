import "server-only";

import { readNewsletterConfiguration } from "./config";
import type { NewsletterConfigurationState } from "./types";

export type NewsletterPublicReadiness =
  | { readonly status: "ready" }
  | { readonly status: "unavailable"; readonly reason: string };

export interface NewsletterReadinessRpcClient {
  rpc(
    functionName: string,
    parameters: { readonly p_site_id: string }
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

export async function readNewsletterPublicReadiness(
  client: NewsletterReadinessRpcClient,
  siteId: string,
  configuration: NewsletterConfigurationState = readNewsletterConfiguration()
): Promise<NewsletterPublicReadiness> {
  if (configuration.status !== "ready") {
    return {
      status: "unavailable",
      reason: configuration.status === "disabled" ? configuration.code : configuration.code
    };
  }

  try {
    const result = await client.rpc("builder_get_newsletter_public_readiness_v1", {
      p_site_id: siteId
    });
    if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
      return { status: "unavailable", reason: "newsletter_readiness_unavailable" };
    }
    const projection = result.data as Record<string, unknown>;
    if (projection.version !== 1 || projection.ready !== true) {
      return { status: "unavailable", reason: "newsletter_not_ready" };
    }
    return { status: "ready" };
  } catch {
    return { status: "unavailable", reason: "newsletter_readiness_unavailable" };
  }
}
