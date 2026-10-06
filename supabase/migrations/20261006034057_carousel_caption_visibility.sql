-- Add an optional caption-display preference without rewriting immutable revisions.
-- CREATE OR REPLACE retains the existing function identity and restricted grants.
create or replace function builder_private.carousel_document_valid(v jsonb, publication boolean) returns boolean
language plpgsql immutable set search_path=pg_catalog,builder_private as $$
declare e jsonb; t jsonb; k text; d jsonb; ids text[]='{}'; uuid_pattern text='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if carousel_exact_keys(v,array['schemaVersion','key','defaults','entries']) is not true or v->'schemaVersion' is distinct from '1'::jsonb or v->'key' is distinct from '"home-community"'::jsonb then return false; end if;
  d=v->'defaults';
  if not carousel_exact_keys(d - 'showCaptions',array['transition','seconds','speed','blend'])
    or (d ? 'showCaptions' and jsonb_typeof(d->'showCaptions') is distinct from 'boolean')
    or d->'transition' not in ('"none"','"fade"','"slide"')
    or d->'seconds' not in ('5','7','10') or d->'speed' not in ('350','700','1100') or not carousel_blend_valid(d->'blend') then return false; end if;
  if jsonb_typeof(v->'entries')<>'array' or jsonb_array_length(v->'entries')<>8 then return false; end if;
  for e in select value from jsonb_array_elements(v->'entries') loop
    if not carousel_exact_keys(e,array['id','media','en','es','desktop','mobile','captionSafeMobile','transition','seconds','blend','zoom'])
      or jsonb_typeof(e->'id')<>'string' or e->>'id' !~ '^[a-z0-9][a-z0-9-]{0,63}$' or e->>'id'=any(ids) then return false; end if;
    ids=array_append(ids,e->>'id');
    if not carousel_exact_keys(e->'media',array['mediaId','revisionId']) or jsonb_typeof(e#>'{media,mediaId}')<>'string' or jsonb_typeof(e#>'{media,revisionId}')<>'string' or e#>>'{media,mediaId}' !~* uuid_pattern or e#>>'{media,revisionId}' !~* uuid_pattern
      or not carousel_frame_valid(e->'desktop') or (e->'mobile'<>'null'::jsonb and not carousel_frame_valid(e->'mobile'))
      or e->'transition' not in ('null','"none"','"fade"','"slide"') or e->'seconds' not in ('null','5','7','10')
      or not carousel_blend_valid(e->'blend') or jsonb_typeof(e->'zoom')<>'boolean' or jsonb_typeof(e->'captionSafeMobile')<>'boolean' then return false; end if;
    foreach k in array array['en','es'] loop
      t=e->k;
      if not carousel_exact_keys(t,array['title','caption','alt']) or jsonb_typeof(t->'title')<>'string' or jsonb_typeof(t->'caption')<>'string' or jsonb_typeof(t->'alt')<>'string'
        or length(t->>'title')>100 or length(t->>'caption')>300 or length(t->>'alt')>300 or ((t->>'title')||(t->>'caption')||(t->>'alt')) ~ '[<>[:cntrl:]]'
        or (publication and btrim(t->>'alt')='') then return false; end if;
    end loop;
    if publication and ((btrim(e#>>'{en,title}')='')<>(btrim(e#>>'{es,title}')='') or (btrim(e#>>'{en,caption}')='')<>(btrim(e#>>'{es,caption}')='')) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end; $$;
