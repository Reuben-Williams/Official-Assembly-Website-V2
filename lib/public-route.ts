export const INTERNAL_PATHNAME_HEADER = "x-builder-internal-pathname";

const NON_PUBLIC_ROOT_SEGMENTS = new Set(["admin", "auth", "api", "_next"]);

export function isPublicAlertPathname(value: string | null | undefined): value is string {
  if (!value || !value.startsWith("/") || value.startsWith("//") ||
      value.includes("?") || value.includes("#") || value.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\") ||
      /[\s\u0000-\u001f\u007f]/.test(decoded)) {
    return false;
  }
  const segments = decoded.split("/").slice(1);
  if (segments.some((segment) => segment === "." || segment === "..")) return false;
  const root = segments[0]?.toLocaleLowerCase("en-US") ?? "";
  return !NON_PUBLIC_ROOT_SEGMENTS.has(root);
}
