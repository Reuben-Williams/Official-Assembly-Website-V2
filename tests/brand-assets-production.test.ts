import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { approvedBrandAssets } from "../lib/brand/approved-assets";

const execFileAsync = promisify(execFile);

describe("approved production brand assets", () => {
  it("activates the reviewed homepage banner and social cover", async () => {
    expect(approvedBrandAssets).not.toBeNull();

    const assets = approvedBrandAssets!;
    expect(assets.entries).toHaveLength(5);
    expect(assets.socialCover).toMatchObject({
      width: 1200,
      height: 630,
      mimeType: "image/png",
    });

    await Promise.all(
      assets.entries.map((entry) =>
        access(resolve(process.cwd(), "public", entry.publicPath.slice(1))),
      ),
    );
  });

  it("verifies the checked-in AVIF, WebP, and PNG files", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/verify-brand-assets.mjs",
      ],
      { cwd: process.cwd() },
    );

    expect(JSON.parse(stdout)).toMatchObject({
      brandAssets: "verified",
      verified: 5,
    });
  });
});
