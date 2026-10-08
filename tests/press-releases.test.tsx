import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as published from '../lib/builder/published-posts';
import { AppHeader } from '../app/ui/AppHeader';
import { applyPostDefaults, editablePostToSnapshot } from '../lib/builder/posts';

vi.mock('next/navigation', () => ({ usePathname: () => '/news', useRouter: () => ({ refresh() {} }) }));

describe('Press Releases publishing boundary', () => {
  it('reserves the static route rather than hiding a new post beneath it', () => {
    expect(() => published.publicPostHref('press-releases')).toThrow(/reserved/i);
  });
  it('rejects the reserved slug in a saved draft as well as a public link', () => {
    const draft = applyPostDefaults({ title:'Release', slug:'press-releases', categoryKeys:[], tagKeys:[], body:{version:1,type:'doc',content:[]},
      entryId:null,draftVersionId:null,publishedVersionId:null,excerpt:'',featuredImage:null,authorName:'Office',authorKey:null,
      displayDate:'2026-10-07T12:00:00Z',expiresAt:null,featured:false,pinned:false,seoTitle:'',seoDescription:'',canonicalUrl:null,noIndex:false,status:'draft' }, {authorName:'Office',now:'2026-10-07T12:00:00Z'});
    expect(() => editablePostToSnapshot(draft)).toThrow(/reserved/i);
  });
  it('uses a category-scoped published repository query, not all posts filtered after limiting', () => {
    expect(Reflect.get(published,'PRESS_RELEASES_QUERY')).toMatchObject({categoryKeys:['press-releases'],limit:100,pinnedFirst:true,orderDirection:'desc'});
  });
  it.each(['en','es'] as const)('keeps News navigable and offers its dedicated disclosure in %s', locale => {
    const html=renderToStaticMarkup(<AppHeader locale={locale}/>);
    expect(html).toContain('href="/news"');
    expect(html).toContain('aria-controls="desktop-news-submenu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(locale==='es'?'Abrir navegación de Noticias':'Open News navigation');
  });
});
