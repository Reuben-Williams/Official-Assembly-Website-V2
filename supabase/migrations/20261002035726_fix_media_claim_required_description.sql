-- Preserve the existing verification, deduplication and upload locking protocol.
-- The v2 wrapper cannot add alt text AFTER an insert into a NOT NULL column.
-- Use the approved upload-plan metadata atomically; never invent a description.
do $migration$
declare
  definition text;
  old_insert text := E'insert into public.builder_media_assets (site_id, id, label, created_by, created_at)\n  values (p_site_id, v_media_id, v_plan.source_name, p_actor_id, p_at);';
  new_insert text := E'insert into public.builder_media_assets (site_id, id, label, alt_text, created_by, created_at)\n  values (p_site_id, v_media_id, v_plan.requested_label, v_plan.requested_alt, p_actor_id, p_at);';
begin
  definition := replace(pg_get_functiondef('builder_private.claim_media_identity(uuid,uuid,uuid,text,text,bigint,integer,integer,timestamptz)'::regprocedure), E'\r\n', E'\n');
  if position(old_insert in definition) = 0 then
    raise exception 'Unexpected media claim definition; review before applying description repair';
  end if;
  execute replace(definition, old_insert, new_insert);
end;
$migration$;
