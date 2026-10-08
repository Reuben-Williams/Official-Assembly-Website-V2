// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorFetch, EDITOR_SESSION_EXPIRED } from '../lib/builder/editor-fetch';

afterEach(() => vi.unstubAllGlobals());
describe('editor authentication recovery', () => {
  it('notifies the mounted editor on 401 without consuming the response or retrying a mutation', async () => {
    const expired = vi.fn();
    window.addEventListener(EDITOR_SESSION_EXPIRED, expired);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    const response = await editorFetch('/api/builder', { method: 'PUT' });
    expect(expired).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ error: { code: 'AUTH_REQUIRED' } });
    window.removeEventListener(EDITOR_SESSION_EXPIRED, expired);
  });
  it.each([200, 403, 503])('does not mistake status %s for an expired session', async status => {
    const expired = vi.fn();
    window.addEventListener(EDITOR_SESSION_EXPIRED, expired);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    await editorFetch('/api/builder');
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener(EDITOR_SESSION_EXPIRED, expired);
  });
});
