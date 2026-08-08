import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  signNewsletterConfirmationToken,
  verifyNewsletterConfirmationToken,
  type NewsletterConfirmationTokenPayload
} from "../lib/newsletter/confirmation-token";

const now = new Date("2026-08-06T17:00:00.000Z");
const keys = new Map([
  ["2026-08", Buffer.alloc(32, 8)],
  ["2026-07", Buffer.alloc(32, 7)]
]);
const payload: NewsletterConfirmationTokenPayload = {
  v: 1,
  site: "31000000-0000-4000-8000-000000000001",
  sub: "32500000-0000-4000-8000-000000000001",
  gen: 1,
  nonce: "n".repeat(48),
  iat: Math.floor(now.getTime() / 1000),
  exp: Math.floor(now.getTime() / 1000) + 48 * 60 * 60,
  kid: "2026-08"
};

describe("newsletter confirmation tokens", () => {
  it("uses fixed-order canonical JSON and base64url HMAC-SHA256 wire encoding", () => {
    const token = signNewsletterConfirmationToken(payload, keys);
    const [encodedPayload, encodedSignature, extra] = token.split(".");

    expect(extra).toBeUndefined();
    expect(Buffer.from(encodedPayload!, "base64url").toString("utf8")).toBe(
      `{"v":1,"site":"${payload.site}","sub":"${payload.sub}","gen":1,"nonce":"${payload.nonce}","iat":${payload.iat},"exp":${payload.exp},"kid":"2026-08"}`
    );
    expect(Buffer.from(encodedSignature!, "base64url")).toHaveLength(32);
    expect(verifyNewsletterConfirmationToken(token, keys, now)).toEqual(payload);
  });

  it("accepts verification-only rotated keys but rejects unknown keys and tampering", () => {
    const oldPayload = { ...payload, kid: "2026-07" };
    const oldToken = signNewsletterConfirmationToken(oldPayload, keys);
    expect(verifyNewsletterConfirmationToken(oldToken, keys, now)).toEqual(oldPayload);

    expect(() => verifyNewsletterConfirmationToken(oldToken, new Map([["2026-08", keys.get("2026-08")!]]), now))
      .toThrow("invalid newsletter confirmation token");
    const [body, signature] = oldToken.split(".");
    expect(() => verifyNewsletterConfirmationToken(`${body}x.${signature}`, keys, now))
      .toThrow("invalid newsletter confirmation token");
  });

  it("rejects duplicate fields, reordered or padded encodings, expiry, and clock skew", () => {
    const token = signNewsletterConfirmationToken(payload, keys);
    const [, signature] = token.split(".");
    const reordered = JSON.stringify({
      site: payload.site,
      v: payload.v,
      sub: payload.sub,
      gen: payload.gen,
      nonce: payload.nonce,
      iat: payload.iat,
      exp: payload.exp,
      kid: payload.kid
    });
    const duplicate = `{"v":1,"v":1,"site":"${payload.site}","sub":"${payload.sub}","gen":1,"nonce":"${payload.nonce}","iat":${payload.iat},"exp":${payload.exp},"kid":"2026-08"}`;

    for (const encoded of [
      Buffer.from(reordered).toString("base64url"),
      Buffer.from(duplicate).toString("base64url"),
      `${token.split(".")[0]}=`
    ]) {
      expect(() => verifyNewsletterConfirmationToken(`${encoded}.${signature}`, keys, now))
        .toThrow("invalid newsletter confirmation token");
    }
    expect(() => verifyNewsletterConfirmationToken(token, keys, new Date(now.getTime() + 48 * 60 * 60 * 1000 + 1_000)))
      .toThrow("invalid newsletter confirmation token");
    const future = signNewsletterConfirmationToken({ ...payload, iat: payload.iat + 301, exp: payload.exp + 301 }, keys);
    expect(() => verifyNewsletterConfirmationToken(future, keys, now))
      .toThrow("invalid newsletter confirmation token");
  });
});
