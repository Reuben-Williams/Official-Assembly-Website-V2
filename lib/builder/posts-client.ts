import type {
  AttachedPostsClient,
  EditablePostDraft,
  LinkablePost,
  PostListItem
} from "@reuben-williams/editor";

export type PostsClientOptions = {
  baseUrl: string;
  getCsrfToken: () => string | null;
  onLinkablePostsChanged?: (posts: LinkablePost[]) => void;
};

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? "The posts service is unavailable.");
  return payload as T;
}

export async function listLinkablePosts(options: PostsClientOptions): Promise<LinkablePost[]> {
  const response = await fetch(`${options.baseUrl}?scope=linkable`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" }
  });
  return readResponse<LinkablePost[]>(response);
}

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
    return readResponse<T>(response);
  }

  async function refreshLinkablePosts() {
    if (!options.onLinkablePostsChanged) return;
    options.onLinkablePostsChanged(await listLinkablePosts(options));
  }

  async function mutate<T>(path: string, init: { method: string; body: unknown; mutation: true }) {
    const result = await request<T>(path, init);
    await refreshLinkablePosts();
    return result;
  }

  const transition = (entryId: string, action: string) =>
    mutate<EditablePostDraft>(`/${encodeURIComponent(entryId)}/${action}`, {
      method: "POST",
      body: {},
      mutation: true
    });

  return {
    listPosts: () => request<PostListItem[]>(),
    getPost: (entryId) => request<EditablePostDraft>(`/${encodeURIComponent(entryId)}`),
    createPost: (draft) => mutate<EditablePostDraft>("", { method: "POST", body: draft, mutation: true }),
    savePost: (draft) => {
      if (!draft.entryId) throw new Error("Save requires an existing post.");
      return mutate<EditablePostDraft>(`/${encodeURIComponent(draft.entryId)}/draft`, {
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
