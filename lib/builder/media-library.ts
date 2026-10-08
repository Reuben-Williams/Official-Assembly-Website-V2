export type MediaLibraryState = { folders: { id: string; name: string }[]; placements: Record<string, string | null>; trashed: string[] };
export type MediaLibrarySnapshot = { version: number; state: MediaLibraryState };
export const EMPTY_MEDIA_LIBRARY: MediaLibrarySnapshot = { version: 0, state: { folders: [], placements: {}, trashed: [] } };

export function validateLibraryCommand(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid library request.");
  const input = value as Record<string, unknown>;
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 0) throw new TypeError("Refresh the media library before trying again.");
  if (input.action === "create-folder") {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80) throw new TypeError("Enter a folder name of 1–80 characters.");
    return { action: input.action, version: Number(input.version), value: { name: input.name.trim() } };
  }
  if (!["move", "trash", "restore"].includes(String(input.action)) || !Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 100 || input.ids.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) throw new TypeError("Select between 1 and 100 uploaded images.");
  if (input.action === "move" && input.folderId !== null && (typeof input.folderId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.folderId))) throw new TypeError("Choose a valid destination folder.");
  return { action: String(input.action), version: Number(input.version), value: { ids: [...new Set(input.ids)], ...(input.action === "move" ? { folderId: input.folderId } : {}) } };
}
