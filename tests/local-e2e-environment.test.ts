import { describe, expect, it } from "vitest";

import {
  assertLocalSupabaseEnvironment,
  parseSupabaseEnvironment,
} from "../scripts/run-local-e2e.mjs";

describe("local browser-test environment", () => {
  it("parses the quoted environment emitted by the Supabase CLI", () => {
    expect(parseSupabaseEnvironment([
      'API_URL="http://127.0.0.1:54321"',
      'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
      'PUBLISHABLE_KEY="local-publishable"',
      'SERVICE_ROLE_KEY="local-service-role"',
    ].join("\n"))).toMatchObject({
      API_URL: "http://127.0.0.1:54321",
      PUBLISHABLE_KEY: "local-publishable",
      SERVICE_ROLE_KEY: "local-service-role",
    });
  });

  it("refuses to provision any non-local Supabase project", () => {
    expect(() => assertLocalSupabaseEnvironment({
      API_URL: "https://project.supabase.co",
      DB_URL: "postgresql://postgres@example.com:5432/postgres",
      PUBLISHABLE_KEY: "publishable",
      SERVICE_ROLE_KEY: "service-role",
    })).toThrow("local Supabase");
  });

  it("accepts the isolated loopback stack used by browser tests", () => {
    expect(() => assertLocalSupabaseEnvironment({
      API_URL: "http://127.0.0.1:54321",
      DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      PUBLISHABLE_KEY: "publishable",
      SERVICE_ROLE_KEY: "service-role",
    })).not.toThrow();
  });
});
