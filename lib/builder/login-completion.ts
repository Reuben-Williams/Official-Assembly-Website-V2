import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { BUILDER_SITE_KEY } from "./authorization";

export const editorLoginCompletionCookie = "builder_login_completion";
export const editorLoginCompletionTtlSeconds = 300;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validResult(value: unknown, status: "issued" | "consumed"): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).version === 1
    && (value as Record<string, unknown>).status === status);
}

export async function issueEditorLoginCompletion(input: {
  client: SupabaseClient;
  userId: string;
  sessionGeneration: number;
  now?: Date;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + editorLoginCompletionTtlSeconds * 1000).toISOString();
  const result = await input.client.rpc("builder_issue_editor_login_completion_proof_v1", {
    p_request: {
      version: 1,
      siteKey: BUILDER_SITE_KEY,
      userId: input.userId,
      sessionGeneration: input.sessionGeneration,
      proofDigest: digest(token),
      expiresAt
    }
  });
  if (result.error || !validResult(result.data, "issued")) {
    throw new Error("editor_login_completion_unavailable");
  }
  return token;
}

export async function consumeEditorLoginCompletion(input: {
  client: SupabaseClient;
  token: string;
  userId: string;
  sessionGeneration: number;
}): Promise<boolean> {
  if (!input.token || input.token.length > 256) return false;
  const result = await input.client.rpc("builder_consume_editor_login_completion_proof_v1", {
    p_request: {
      version: 1,
      siteKey: BUILDER_SITE_KEY,
      userId: input.userId,
      sessionGeneration: input.sessionGeneration,
      proofDigest: digest(input.token)
    }
  });
  return !result.error && validResult(result.data, "consumed");
}
