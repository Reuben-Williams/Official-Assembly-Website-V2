// @vitest-environment jsdom
import {beforeEach,expect,it} from 'vitest';
import {applyDraftPageImages} from '../lib/builder/page-image-preview';
const src='/api/builder/media/11111111-1111-4111-8111-111111111111?preview=1';
beforeEach(()=>{document.body.innerHTML='<div data-builder-kind="image" data-builder-region="photo"><picture><source media="(max-width:640px)" srcset="/old-mobile.webp"><img src="/old.webp" srcset="/old-640.webp 640w, /old-1280.webp 1280w" alt="Old photo"></picture></div><div data-builder-kind="text" data-builder-region="text">Published text</div>';});
it('shows the authenticated saved image instead of stale responsive image candidates',()=>{
 applyDraftPageImages(document,{photo:{type:'image',src,alt:'Saved community photo'}});
 const image=document.querySelector('img')!;
 expect(image.getAttribute('src')).toBe(src);expect(image.hasAttribute('srcset')).toBe(false);
 expect(document.querySelector('source')!.hasAttribute('srcset')).toBe(false);
 expect(image.alt).toBe('Saved community photo');
});
it('does not change unrelated text or images without a saved override',()=>{
 applyDraftPageImages(document,{text:{type:'text',value:'Unsaved text'}});
 expect(document.querySelector('img')!.getAttribute('src')).toBe('/old.webp');
 expect(document.querySelector('[data-builder-region="text"]')!.textContent).toBe('Published text');
});
it('rejects unsafe sources without changing responsive images',()=>{
 for(const source of ['javascript:alert(1)','data:text/html,unsafe','https://user:password@example.com/photo.jpg']) {
  applyDraftPageImages(document,{photo:{type:'image',src:source,alt:'Unsafe'}});
  expect(document.querySelector('img')!.getAttribute('src')).toBe('/old.webp');
  expect(document.querySelector('img')!.hasAttribute('srcset')).toBe(true);
 }
});
