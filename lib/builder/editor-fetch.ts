export const EDITOR_SESSION_EXPIRED = 'morales:editor-session-expired';
// Leave the response intact for each workspace's existing error handling. A 403
// is a permissions decision, not a reason to recreate or broaden the session.
export const editorFetch: typeof fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init);
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EDITOR_SESSION_EXPIRED));
  }
  return response;
};
