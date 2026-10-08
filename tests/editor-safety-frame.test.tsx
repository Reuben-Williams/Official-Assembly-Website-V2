// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorSafetyFrame } from '../app/admin/editor/editor-safety-frame';
import { EDITOR_SESSION_EXPIRED } from '../lib/builder/editor-fetch';
import { ReportedMediaUploadError } from '../lib/builder/media-client';
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"status":"active"}'))); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('locks the mounted editor after expiration and preserves its state while the user signs in in a new tab', async () => {
  const restored = vi.fn();
  await act(async () => root.render(<EditorSafetyFrame upload={{status:'idle'}} onSessionRestored={restored}><input defaultValue="unsaved photo description" /></EditorSafetyFrame>));
  const editorInput = host.querySelector('input');
  await act(async () => window.dispatchEvent(new Event(EDITOR_SESSION_EXPIRED)));
  expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('Sign in again');
  expect(host.querySelector('[data-editor-controls]')?.hasAttribute('inert')).toBe(true);
  expect(host.querySelector('a')?.target).toBe('_blank');
  await act(async () => (host.querySelector('[data-resume-editor]') as HTMLButtonElement).click());
  expect(restored).toHaveBeenCalledOnce();
  expect(host.querySelector('input')).toBe(editorInput);
  expect(host.querySelector('[data-editor-controls]')?.hasAttribute('inert')).toBe(false);
});
it('blocks saving during an unfinished upload and shows a clear failure without replacing the old image', async () => {
  await act(async () => root.render(<EditorSafetyFrame upload={{status:'uploading',name:'photo.png'}} onSessionRestored={()=>{}}><button>Save draft</button></EditorSafetyFrame>));
  expect(host.textContent).toContain('Uploading photo.png');
  expect(host.querySelector('[data-editor-controls]')?.hasAttribute('inert')).toBe(true);
  await act(async () => root.render(<EditorSafetyFrame upload={{status:'error',name:'photo.png',message:'Choose a smaller image.'}} onSessionRestored={()=>{}}><button>Save draft</button></EditorSafetyFrame>));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Choose a smaller image.');
  expect(host.querySelector('[data-editor-controls]')?.hasAttribute('inert')).toBe(false);
  const handled = new Event('unhandledrejection', {cancelable:true});
  Object.defineProperty(handled,'reason',{value:new ReportedMediaUploadError('Choose a smaller image.')});
  window.dispatchEvent(handled); expect(handled.defaultPrevented).toBe(true);
  const unrelated = new Event('unhandledrejection', {cancelable:true});
  Object.defineProperty(unrelated,'reason',{value:new Error('unrelated')});
  window.dispatchEvent(unrelated); expect(unrelated.defaultPrevented).toBe(false);
});
