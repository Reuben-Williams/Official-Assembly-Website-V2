import { describe, expect, it } from "vitest";

import { authorizeNewsletterStaffRequest } from "../lib/newsletter/staff-authorization";

const origin = "https://www.assemblywomanmorales.com";
const identity = {
  userId: "34300000-0000-4000-8000-000000000001",
  role: "owner" as const,
  siteKey: "official-assembly-website-v2",
  siteId: "34000000-0000-4000-8000-000000000001",
  sessionGeneration: 2,
  tokenGeneration: 2,
  csrfToken: "csrf-token"
};

function request(headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/newsletter/operations/validate`, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "x-builder-csrf": "csrf-token",
      ...headers
    }
  });
}

describe("newsletter staff authorization", () => {
  it("requires an active owner, same origin, and editor CSRF for mutations", async () => {
    await expect(authorizeNewsletterStaffRequest(request(), {
      mutation: true,
      authenticate: async () => identity
    })).resolves.toEqual(identity);

    for (const candidate of [
      { request: request(), member: null },
      { request: request(), member: { ...identity, role: "editor" as const } },
      { request: request({ origin: "https://attacker.example" }), member: identity },
      { request: request({ "x-builder-csrf": "wrong" }), member: identity },
      { request: request(), member: { ...identity, tokenGeneration: 1 } }
    ]) {
      await expect(authorizeNewsletterStaffRequest(candidate.request, {
        mutation: true,
        authenticate: async () => candidate.member
      })).rejects.toMatchObject({ status: expect.any(Number) });
    }
  });

  it("allows active non-owners to read only bounded status", async () => {
    await expect(authorizeNewsletterStaffRequest(
      new Request(`${origin}/api/newsletter/operations/status`),
      { mutation: false, authenticate: async () => ({ ...identity, role: "viewer" as const }) }
    )).resolves.toMatchObject({ role: "viewer" });
  });
});
