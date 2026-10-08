// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({path:vi.fn(),apply:vi.fn()}));
vi.mock('next/navigation',()=>({usePathname:mocks.path}));
vi.mock('@reuben-williams/next',()=>({BuilderPreviewBridge:()=>null}));
vi.mock('../lib/builder/page-image-preview',()=>({applyDraftPageImages:mocks.apply}));
import {BuilderContentBridge} from '../app/builder-content-bridge';
let root:Root;
const originalParent=window.parent;
const fetcher=vi.fn();
beforeEach(()=>{
 vi.clearAllMocks();mocks.path.mockReturnValue('/news');
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 document.body.innerHTML='<div id="test-root"></div>';root=createRoot(document.getElementById('test-root')!);
 vi.stubGlobal('fetch',fetcher);fetcher.mockResolvedValue(Response.json({regions:{photo:{type:'image',src:'/api/builder/media/11111111-1111-4111-8111-111111111111?preview=1',alt:'Photo'}}}));
 window.history.replaceState(null,'','/news');Object.defineProperty(window,'parent',{configurable:true,value:originalParent});
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();Object.defineProperty(window,'parent',{configurable:true,value:originalParent});});
it('does not fetch or modify public page images',async()=>{
 await act(async()=>root.render(<BuilderContentBridge/>));expect(fetcher).not.toHaveBeenCalled();expect(mocks.apply).not.toHaveBeenCalled();
});
it('does not expose private drafts from a top-level preview URL',async()=>{
 window.history.replaceState(null,'','/news?builderPreview=1&builderSiteId=official-assembly-website-v2');
 await act(async()=>root.render(<BuilderContentBridge/>));expect(fetcher).not.toHaveBeenCalled();
});
it('loads authenticated saved photos only within the correct editor preview',async()=>{
 Object.defineProperty(window,'parent',{configurable:true,value:{}});
 window.history.replaceState(null,'','/news?builderPreview=1&builderSiteId=official-assembly-website-v2');
 await act(async()=>root.render(<BuilderContentBridge/>));
 expect(fetcher).toHaveBeenCalledWith('/api/builder?mode=draft&path=%2Fnews',expect.objectContaining({credentials:'same-origin',cache:'no-store'}));
 expect(mocks.apply).toHaveBeenCalledWith(document,expect.objectContaining({photo:expect.objectContaining({src:expect.stringContaining('preview=1')})}));
});
it('reports unavailable private previews without modifying the public fallback',async()=>{
 Object.defineProperty(window,'parent',{configurable:true,value:{}});
 window.history.replaceState(null,'','/news?builderPreview=1&builderSiteId=official-assembly-website-v2');
 fetcher.mockResolvedValue(new Response(null,{status:401}));
 await act(async()=>root.render(<BuilderContentBridge/>));expect(mocks.apply).not.toHaveBeenCalled();
 expect(document.querySelector('[role="alert"]')?.textContent).toContain('Saved photos could not be loaded');
});
