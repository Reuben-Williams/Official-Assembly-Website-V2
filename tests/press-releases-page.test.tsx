import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({locale:'en',load:vi.fn()}));
vi.mock('../app/i18n/server',()=>({readPublicLocale:async()=>state.locale}));
vi.mock('../lib/supabase/admin',()=>({getBuilderAdminClient:()=>({})}));
vi.mock('../lib/builder/published-posts',()=>({listPublishedPressReleases:state.load,publicPostHref:(slug:string)=>`/news/${slug}`}));
import Page,{generateMetadata} from '../app/news/press-releases/page';
beforeEach(()=>{state.locale='en';state.load.mockReset();state.load.mockResolvedValue([]);});
describe('Press Releases page',()=>{
 it.each(['en','es'])('uses a truthful empty state and canonical metadata in %s',async(locale)=>{
  state.locale=locale;
  const html=renderToStaticMarkup(await Page());expect(html).toContain(locale==='es'?'Todavía no hay comunicados publicados':'No press releases have been published yet');
  const meta=await generateMetadata();expect(meta.alternates?.canonical).toContain('/news/press-releases');
 });
 it('does not confuse a repository failure with no published releases',async()=>{
  state.load.mockRejectedValue(new Error('unavailable'));const html=renderToStaticMarkup(await Page());
  expect(html).toContain('temporarily unavailable');expect(html).not.toContain('No press releases have been published yet');
 });
 it('links actual releases to their existing news details',async()=>{
  state.load.mockResolvedValue([{entryId:'release-id',slug:'office-release',title:'Office release',excerpt:'Published statement',displayDate:'2026-10-07T12:00:00Z',categoryKeys:['press-releases'],tagKeys:[]}]);
  const html=renderToStaticMarkup(await Page());expect(html).toContain('href="/news/office-release"');expect(html).toContain('Published statement');
 });
});
