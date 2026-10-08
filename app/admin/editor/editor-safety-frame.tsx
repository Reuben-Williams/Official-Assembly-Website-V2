'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ReportedMediaUploadError, type MediaUploadState } from '../../../lib/builder/media-client';
import { editorFetch, EDITOR_SESSION_EXPIRED } from '../../../lib/builder/editor-fetch';

export function EditorSafetyFrame({ children, upload, onSessionRestored }: {
  children: ReactNode; upload: MediaUploadState; onSessionRestored: () => void;
}) {
  const [expired, setExpired] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resumeMessage, setResumeMessage] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const uploadState = useRef(upload);
  useEffect(() => { uploadState.current = upload; }, [upload]);
  useEffect(() => {
    const abort = new AbortController();
    const expire = () => setExpired(true);
    // The published gallery does not catch upload rejections. Only suppress a
    // failure already displayed by this adapter, never unrelated application errors.
    const reportedFailure = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof ReportedMediaUploadError && uploadState.current.status === 'error') event.preventDefault();
    };
    const check = () => {
      if (document.visibilityState !== 'hidden') void editorFetch('/api/builder/session', {
        cache: 'no-store', credentials: 'same-origin', signal: abort.signal,
      }).catch(() => { /* A network failure is not evidence of an expired session. */ });
    };
    window.addEventListener(EDITOR_SESSION_EXPIRED, expire);
    window.addEventListener('unhandledrejection', reportedFailure);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const interval = window.setInterval(check, 60_000);
    check();
    return () => {
      abort.abort(); window.clearInterval(interval);
      window.removeEventListener(EDITOR_SESSION_EXPIRED, expire);
      window.removeEventListener('unhandledrejection', reportedFailure);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  useEffect(() => { if (expired) dialog.current?.focus(); }, [expired]);
  async function resume() {
    setChecking(true); setResumeMessage('');
    try {
      const response = await editorFetch('/api/builder/session', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) { setResumeMessage('Finish signing in in the other tab, then try again.'); return; }
      setExpired(false); onSessionRestored();
    } catch { setResumeMessage('The connection could not be verified. Please try again.'); }
    finally { setChecking(false); }
  }
  const busy = upload.status === 'uploading';
  const returnTo = typeof window === 'undefined' ? '/admin/editor' : `${window.location.pathname}${window.location.search}`;
  return <>
    {upload.status !== 'idle' && <div className={`editor-upload-feedback ${upload.status}`} role={upload.status === 'error' ? 'alert' : 'status'}>
      {upload.status === 'uploading' ? `Uploading ${upload.name}… Please wait before saving.` : upload.status === 'error'
        ? upload.message : 'Image uploaded and ready. Save draft, then Publish to update the public page.'}
    </div>}
    <div data-editor-controls inert={expired || busy} aria-busy={busy}>{children}</div>
    {(expired || busy) && <div className="editor-safety-overlay">
      {expired ? <section className="editor-safety-dialog" ref={dialog} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="editor-session-heading" onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = dialog.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
        <h2 id="editor-session-heading">Sign in again to continue editing</h2>
        <p>Your staff session has expired. Saved drafts are safe. Keep this tab open so your current edits stay in place.</p>
        <a className="editor-safety-primary" href={`/admin/login?returnTo=${encodeURIComponent(returnTo)}`} target="_blank" rel="noopener">Sign in again<span className="visually-hidden"> (opens a new tab)</span></a>
        <button type="button" data-resume-editor disabled={checking} onClick={() => void resume()}>{checking ? 'Checking your sign-in…' : 'I signed in — resume editing'}</button>
        {resumeMessage && <p role="status">{resumeMessage}</p>}
      </section> : <section className="editor-safety-dialog" role="status">
        <h2>Uploading {upload.status === 'uploading' ? upload.name : 'image'}…</h2>
        <p>Save is paused until your image is ready. Large photos are automatically resized to fit the upload limits, without cropping. PNG and WebP images are converted to JPEG. Your original file stays unchanged.</p>
      </section>}
    </div>}
  </>;
}
