type EditorPage = { path: string };

export function resolveEditorPagePath(
  candidate: unknown,
  pages: readonly EditorPage[]
): string | null {
  if (typeof candidate !== "string" || !candidate.startsWith("/") ||
      candidate.startsWith("//") || /[?#\\\s]/.test(candidate)) {
    return null;
  }
  const normalized = candidate === "/" ? candidate : candidate.replace(/\/+$/, "") || "/";
  return pages.some((page) => page.path === normalized) ? normalized : null;
}
