// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TurnstileAwareBuilderForm } from '../app/ui/TurnstileAwareBuilderForm';

const projection = {
  formKey: 'contact', revisionId: '30000000-0000-4000-8000-000000000001', displayName: 'Contact',
  fields: [{key:'firstName',label:'First name',kind:'text',required:true,helpText:'',placeholder:''}],
  consent:{fieldKey:'consent',policyVersion:'v1',renderedText:'Contact consent'},
  completion:{mode:'inline_success'},turnstile:{siteKey:'test-site-key',action:'contact'},
};
let host: HTMLDivElement;
let root: Root;
let options: Record<string, unknown>;
const renderWidget = vi.fn((element: HTMLElement, value: Record<string, unknown>) => {
  options=value;
  element.innerHTML='<input type="hidden" name="cf-turnstile-response" value="">';
  return 'widget-1';
});
const remove = vi.fn();
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.clearAllMocks();
  vi.stubGlobal('turnstile',{render:renderWidget,remove,reset:vi.fn()});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.useRealTimers();});
async function mount(key='contact') {
  await act(async()=>root.render(<TurnstileAwareBuilderForm key={key} variant="contact" endpoint="/api/forms/contact" projection={projection as never}/>));
}
it('initializes a newly mounted form when the verification script is already loaded',async()=>{
  await mount();
  expect(renderWidget).toHaveBeenCalledOnce();
  expect(host.querySelector('[name="cf-turnstile-response"]')).not.toBeNull();
  await mount('next-visit');
  expect(remove).toHaveBeenCalledWith('widget-1');
  expect(renderWidget).toHaveBeenCalledTimes(2);
});
it('provides retry after a widget failure without erasing typed fields',async()=>{
  await mount();
  host.querySelector<HTMLInputElement>('[name="firstName"]')!.value='Keep this name';
  expect(typeof options?.['error-callback']).toBe('function');
  await act(async()=>{(options['error-callback'] as ()=>void)();});
  const retry=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Retry verification');
  expect(retry).toBeDefined();
  await act(async()=>retry!.click());
  expect(renderWidget).toHaveBeenCalledTimes(2);
  expect(host.querySelector<HTMLInputElement>('[name="firstName"]')!.value).toBe('Keep this name');
});
it('shows verified status and clears stale tokens on expiration',async()=>{
  await mount();
  expect(typeof options?.callback).toBe('function');
  await act(async()=>{(options.callback as ()=>void)();});
  expect(host.textContent).toContain('Verification complete');
  host.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]')!.value='old-token';
  await act(async()=>{(options['expired-callback'] as ()=>void)();});
  expect(host.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]')!.value).toBe('');
});
it('replaces indefinite widget loading with a recoverable failure',async()=>{
  vi.useFakeTimers();
  await mount();
  await act(async()=>{await vi.advanceTimersByTimeAsync(45_000);});
  expect(host.textContent).toContain('Verification could not complete');
  expect(host.textContent).toContain('Retry verification');
});
it('ignores callbacks from a removed widget',async()=>{
  await mount();
  const oldCallback=options.callback as ()=>void;
  await mount('replacement');
  await act(async()=>oldCallback());
  expect(host.textContent).not.toContain('Verification complete');
});
it('recovers a blocked script on retry without resetting the form',async()=>{
  vi.useFakeTimers();
  vi.stubGlobal('turnstile',undefined);
  await mount();
  const firstScript=document.querySelector<HTMLScriptElement>('script[data-form-verification]')!;
  expect(firstScript.src).toContain('render=explicit');
  host.querySelector<HTMLInputElement>('[name="firstName"]')!.value='Preserved';
  await act(async()=>{await vi.advanceTimersByTimeAsync(15_000);});
  expect(host.textContent).toContain('Verification could not complete');
  expect(document.contains(firstScript)).toBe(false);
  const retry=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Retry verification')!;
  await act(async()=>retry.click());
  vi.stubGlobal('turnstile',{render:renderWidget,remove});
  const replacement=document.querySelector<HTMLScriptElement>('script[data-form-verification]')!;
  await act(async()=>replacement.dispatchEvent(new Event('load')));
  expect(renderWidget).toHaveBeenCalledOnce();
  expect(host.querySelector<HTMLInputElement>('[name="firstName"]')!.value).toBe('Preserved');
  replacement.remove();
});
