const MAX_PUBLIC_URL_LENGTH = 2_048;

export const PUBLIC_LINK_ALLOWED_HOSTS = Object.freeze([
  "docs.google.com",
  "nj-34-assembly-morales.web.fireside21.app",
  "www.essexclerk.com",
  "www.nj.gov",
  "www.njleg.state.nj.us"
] as const);

const allowedHosts = new Set<string>(PUBLIC_LINK_ALLOWED_HOSTS);

export function parseSafePublicUrl(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("A public URL is required.");
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("The public URL is invalid.");
  }

  if (parsed.protocol !== "https:") {
    throw new TypeError("Public URLs must use HTTPS.");
  }

  if (parsed.username || parsed.password) {
    throw new TypeError("Public URLs cannot include credentials.");
  }

  if (parsed.port) {
    throw new TypeError("Public URLs cannot use a non-default port.");
  }

  const hostname = parsed.hostname.toLowerCase();

  if (!allowedHosts.has(hostname)) {
    throw new TypeError("The public URL host is not approved.");
  }

  const normalized = parsed.toString();

  if (normalized.length > MAX_PUBLIC_URL_LENGTH) {
    throw new TypeError("Public URLs cannot exceed 2,048 characters.");
  }

  return normalized;
}
