import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx", ".sql"]);
const ROOTS = ["app", "lib", "supabase/migrations", "supabase/seed.sql"];

function extension(path) {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}

function files(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return SOURCE_EXTENSIONS.has(extension(path)) ? [path] : [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    files(resolve(path, entry.name))
  );
}

function lineNumber(contents, index) {
  return contents.slice(0, index).split("\n").length;
}

function addMatches(violations, file, contents, code, pattern, message) {
  for (const match of contents.matchAll(pattern)) {
    violations.push({ code, file, line: lineNumber(contents, match.index ?? 0), message });
  }
}

export function inspectNewsletterBoundaries(root) {
  const projectRoot = resolve(root);
  const violations = [];
  const sourceFiles = ROOTS.flatMap((candidate) => files(resolve(projectRoot, candidate)));

  for (const absolute of sourceFiles) {
    const file = relative(projectRoot, absolute).replaceAll("\\", "/");
    const contents = readFileSync(absolute, "utf8");
    const clientModule = /^\s*["']use client["'];/m.test(contents.slice(0, 512));

    if (clientModule) {
      addMatches(
        violations,
        file,
        contents,
        "CLIENT_RESEND_IMPORT",
        /(?:from\s+["']resend["']|require\(["']resend["']\))/g,
        "Client modules may not import the Resend SDK."
      );
    }
    addMatches(
      violations,
      file,
      contents,
      "PUBLIC_NEWSLETTER_SECRET",
      /NEXT_PUBLIC_(?:RESEND|NEWSLETTER_(?:CONFIRMATION|TEST|WEBHOOK|SEND|MANAGEMENT))[A-Z0-9_]*/g,
      "Newsletter credentials and verification material may not use a public environment variable."
    );
    addMatches(
      violations,
      file,
      contents,
      "RESEND_WITHOUT_API_KEY",
      /new\s+Resend\s*\(\s*\)/g,
      "Resend clients must be constructed with an explicit server-only API key."
    );
    addMatches(
      violations,
      file,
      contents,
      "BROADCAST_MUTATION",
      /\.broadcasts\.(?:create|update|send|schedule|remove|delete)\s*\(/g,
      "Application code may inspect Broadcasts but may not create, mutate, schedule, or send them."
    );
    addMatches(
      violations,
      file,
      contents,
      "SENSITIVE_LOGGING",
      /console\.(?:log|info|debug|warn|error)\s*\([^\n;]*(?:token|payload|rawBody|request\.body|response\.body)/gi,
      "Tokens, raw bodies, and provider payloads may not be logged."
    );
    if (file.endsWith(".sql") && /newsletter/i.test(file)) {
      addMatches(
        violations,
        file,
        contents,
        "SYNTHETIC_NEWSLETTER_SEED",
        /insert\s+into[^;\n]*(?:synthetic|placeholder|sample@example|fake@example)/gi,
        "Production newsletter migrations may not insert synthetic subscriber data."
      );
      addMatches(
        violations,
        file,
        contents,
        "RAW_PROVIDER_PAYLOAD_STORAGE",
        /(?:raw_webhook_body|raw_provider_payload|provider_payload\s+(?:json|jsonb|text|bytea))/gi,
        "Newsletter tables may not retain raw provider payloads."
      );
    }
  }

  return violations.sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line || left.code.localeCompare(right.code)
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const violations = inspectNewsletterBoundaries(process.cwd());
  if (violations.length) {
    for (const violation of violations) {
      process.stderr.write(`${violation.file}:${violation.line} ${violation.code} ${violation.message}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write("Newsletter release boundaries: PASS\n");
  }
}
