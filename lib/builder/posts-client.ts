import type { AttachedPostsClient, EditablePostDraft, PostListItem } from "@reuben-williams/editor";

type PostsClientOptions = {
  baseUrl: string;
  getCsrfToken: () => string | null;
};

export function createHttpPostsClient(options: PostsClientOptions): AttachedPostsClient {
  async function request<T>(path = "", init?: { method?: string; body?: unknown; mutation?: boolean }): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init?.body !== undefined) headers["content-type"] = "application/json";
    if (init?.mutation) {
      const csrf = options.getCsrfToken();
      if (!csrf) throw new Error("The editor session could not be verified. Sign in again.");
      headers["x-builder-csrf"] = csrf;
      headers["x-idempotency-key"] = `post:${crypto.randomUUID()}`;
    }
    const response = await fetch(`${options.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers,
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {})
    });
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    if (!response.ok) throw new Error(payload?.error?.message ?? "The posts service is unavailable.");
    return payload as T;
  }

  const transition = (entryId: string, action: string) =>
    request<EditablePostDraft>(`/${encodeURIComponent(entryId)}/${action}`, {
      method: "POST",
      body: {},
      mutation: true
    });

  return {
    listPosts: () => request<PostListItem[]>(),
    getPost: (entryId) => request<EditablePostDraft>(`/${encodeURIComponent(entryId)}`),
    createPost: (draft) => request<EditablePostDraft>("", { method: "POST", body: draft, mutation: true }),
    savePost: (draft) => {
      if (!draft.entryId) throw new Error("Save requires an existing post.");
      return request<EditablePostDraft>(`/${encodeURIComponent(draft.entryId)}/draft`, {
        method: "POST",
        body: draft,
        mutation: true
      });
    },
    publishPost: (entryId) => transition(entryId, "publish"),
    archivePost: (entryId) => transition(entryId, "archive"),
    restorePost: (entryId) => transition(entryId, "restore-draft"),
    deletePost: async () => {
      throw new Error("Permanent post deletion is not enabled. Archive the post instead.");
    }
  };
}
