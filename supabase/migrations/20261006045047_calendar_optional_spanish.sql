-- Optional Spanish content uses field-specific English fallback in public rendering.
-- Preserve the function identity, ACL, saved revisions, and every other publication gate.
create or replace function builder_private.builder_calendar_revision_publishable_v1(
  p_revision public.builder_calendar_event_revisions
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    char_length(btrim(p_revision.title_en)) between 1 and 160
    and char_length(btrim(p_revision.title_es)) between 0 and 160
    and char_length(btrim(p_revision.description_en)) between 1 and 5000
    and char_length(btrim(p_revision.description_es)) between 0 and 5000
    and p_revision.start_at is not null
    and char_length(btrim(p_revision.location_name)) between 1 and 200
    and char_length(btrim(p_revision.location_address)) between 1 and 500
    and p_revision.public_approved
    and p_revision.hosted_by_office
    and (
      (p_revision.action_url is null and p_revision.action_label_en = '' and p_revision.action_label_es = '')
      or (
        p_revision.action_url is not null
        and char_length(btrim(p_revision.action_label_en)) between 1 and 120
        and char_length(btrim(p_revision.action_label_es)) between 0 and 120
      )
    )
    and (
      p_revision.media_asset_id is null
      or exists (
        select 1
        from public.builder_media_assets asset
        where asset.site_id = p_revision.site_id
          and asset.id = p_revision.media_asset_id
          and asset.archived_at is null
          and exists (
            select 1 from public.builder_media_revisions media_revision
            where media_revision.site_id = asset.site_id and media_revision.media_id = asset.id
          )
      )
    );
$$;
