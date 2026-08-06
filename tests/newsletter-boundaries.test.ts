import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The release checker is intentionally executable JavaScript.
import { inspectNewsletterBoundaries } from "../scripts/check-newsletter-boundaries.mjs";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { force: true, recursive: true });
});

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "newsletter-boundary-"));
  temporary.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const destination = join(root, relative);
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, contents, "utf8");
  }
  return root;
}

describe("newsletter release boundaries", () => {
  it("rejects a Resend client constructed without an explicit API key", () => {
    const root = fixture({
      "lib/webhook.ts": 'import { Resend } from "resend";\nconst resend = new Resend();\n'
    });

    expect(inspectNewsletterBoundaries(root).map((item: { code: string }) => item.code)).toContain(
      "RESEND_WITHOUT_API_KEY"
    );
  });

  it("rejects browser Resend imports, public secrets, Broadcast mutations, and unsafe logging", () => {
    const root = fixture({
      "app/client.tsx": '"use client";\nimport { Resend } from "resend";\n',
      "lib/config.ts": 'const key = process.env.NEXT_PUBLIC_RESEND_API_KEY;\n',
      "lib/send.ts": 'resend.broadcasts.send("broadcast_1");\nconsole.log(payload);\n'
    });

    expect(inspectNewsletterBoundaries(root).map((item: { code: string }) => item.code)).toEqual(
      expect.arrayContaining([
        "CLIENT_RESEND_IMPORT",
        "PUBLIC_NEWSLETTER_SECRET",
        "BROADCAST_MUTATION",
        "SENSITIVE_LOGGING"
      ])
    );
  });

  it("accepts the current production source tree", () => {
    expect(inspectNewsletterBoundaries(process.cwd())).toEqual([]);
  });
});
