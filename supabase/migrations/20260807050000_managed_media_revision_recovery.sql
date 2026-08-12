alter table public.builder_media_assets
  add column alt_text text;

update public.builder_media_assets
set alt_text = label
where alt_text is null;

alter table public.builder_media_assets
  alter column alt_text set not null,
  add constraint builder_media_assets_alt_text_length
    check (char_length(btrim(alt_text)) between 1 and 500);

alter table public.builder_media_upload_plans
  add column requested_label text,
  add column requested_alt text;

update public.builder_media_upload_plans
set requested_label = source_name,
    requested_alt = source_name
where requested_label is null or requested_alt is null;

alter table public.builder_media_upload_plans
  alter column requested_label set not null,
  alter column requested_alt set not null,
  add constraint builder_media_upload_plans_requested_label_length
    check (char_length(btrim(requested_label)) between 1 and 200),
  add constraint builder_media_upload_plans_requested_alt_length
    check (char_length(btrim(requested_alt)) between 1 and 500);

alter table public.builder_media_recovery_replicas
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column available_at timestamptz not null default now(),
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column fence_token bigint not null default 0 check (fence_token >= 0),
  add column created_at timestamptz not null default now(),
  add constraint builder_media_recovery_replicas_lease_pair
    check ((lease_owner is null) = (lease_expires_at is null)),
  add constraint builder_media_recovery_replicas_ready_unleased
    check (status <> 'ready' or lease_owner is null);

create index builder_media_recovery_replicas_due_idx
  on public.builder_media_recovery_replicas (available_at, site_id, revision_id)
  where status = 'pending';

create or replace function builder_private.enqueue_media_recovery_replica_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.builder_media_recovery_replicas
    (site_id, media_id, revision_id, status, available_at, updated_at)
  values (new.site_id, new.media_id, new.id, 'pending', now(), now())
  on conflict (site_id, media_id, revision_id) do nothing;
  return new;
end;
$$;

create trigger builder_media_revision_recovery_enqueue
after insert on public.builder_media_revisions
for each row execute function builder_private.enqueue_media_recovery_replica_v1();

insert into public.builder_media_recovery_replicas
  (site_id, media_id, revision_id, status, available_at, updated_at)
select revision.site_id, revision.media_id, revision.id, 'pending', now(), now()
from public.builder_media_revisions revision
on conflict (site_id, media_id, revision_id) do nothing;

create or replace function public.builder_claim_media_identity_v2(
  p_site_id uuid,
  p_plan_id uuid,
  p_actor_id uuid,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_result jsonb;
begin
  v_result := builder_private.claim_media_identity(
    p_site_id, p_plan_id, p_actor_id, p_sha256, p_mime_type,
    p_byte_size, p_width, p_height, p_at
  );
  if v_result->>'status' = 'finalized' then
    update public.builder_media_assets asset
    set label = plan.requested_label,
        alt_text = plan.requested_alt
    from public.builder_media_upload_plans plan
    where plan.site_id = p_site_id
      and plan.id = p_plan_id
      and plan.created_by = p_actor_id
      and asset.site_id = plan.site_id
      and asset.id = (v_result->>'mediaId')::uuid;
  end if;
  return v_result;
end;
$$;

create or replace function public.builder_claim_media_recovery_replica_v1(
  p_worker text,
  p_lease_seconds integer default 60,
  p_at timestamptz default now()
)
returns table (
  site_id uuid,
  site_key text,
  media_id uuid,
  revision_id uuid,
  object_key text,
  content_digest text,
  byte_size bigint,
  mime_type text,
  fence_token bigint,
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_replica public.builder_media_recovery_replicas%rowtype;
begin
  if btrim(coalesce(p_worker, '')) = '' or p_lease_seconds not between 15 and 300 then
    raise exception 'INVALID_MEDIA_RECOVERY_CLAIM' using errcode = '22023';
  end if;
  select replica.* into v_replica
  from public.builder_media_recovery_replicas replica
  where replica.status = 'pending'
    and replica.available_at <= p_at
    and (replica.lease_expires_at is null or replica.lease_expires_at <= p_at)
  order by replica.available_at, replica.site_id, replica.revision_id
  for update skip locked
  limit 1;
  if not found then return; end if;

  update public.builder_media_recovery_replicas replica
  set lease_owner = p_worker,
      lease_expires_at = p_at + make_interval(secs => p_lease_seconds),
      fence_token = replica.fence_token + 1,
      attempt_count = replica.attempt_count + 1,
      updated_at = p_at
  where replica.site_id = v_replica.site_id
    and replica.media_id = v_replica.media_id
    and replica.revision_id = v_replica.revision_id
  returning replica.* into v_replica;

  return query
  select v_replica.site_id, site.site_key, v_replica.media_id, v_replica.revision_id,
    revision.object_key, revision.sha256, revision.byte_size, revision.mime_type,
    v_replica.fence_token, v_replica.attempt_count
  from public.builder_media_revisions revision
  join public.builder_sites site on site.id = revision.site_id
  where revision.site_id = v_replica.site_id
    and revision.media_id = v_replica.media_id
    and revision.id = v_replica.revision_id;
end;
$$;

create or replace function public.builder_complete_media_recovery_replica_v1(
  p_site_id uuid,
  p_media_id uuid,
  p_revision_id uuid,
  p_worker text,
  p_fence_token bigint,
  p_content_digest text,
  p_byte_size bigint,
  p_mime_type text,
  p_object_path text,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  if p_content_digest !~ '^[a-f0-9]{64}$' or p_byte_size < 1 or p_mime_type not like 'image/%'
    or btrim(coalesce(p_object_path, '')) = '' then
    raise exception 'INVALID_MEDIA_RECOVERY_RESULT' using errcode = '22023';
  end if;
  update public.builder_media_recovery_replicas replica
  set status = 'ready',
      content_digest = p_content_digest,
      byte_size = p_byte_size,
      mime_type = p_mime_type,
      object_path = p_object_path,
      verified_at = p_at,
      last_error = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = p_at
  where replica.site_id = p_site_id
    and replica.media_id = p_media_id
    and replica.revision_id = p_revision_id
    and replica.status = 'pending'
    and replica.lease_owner = p_worker
    and replica.fence_token = p_fence_token
    and exists (
      select 1 from public.builder_media_revisions revision
      where revision.site_id = replica.site_id
        and revision.media_id = replica.media_id
        and revision.id = replica.revision_id
        and revision.sha256 = p_content_digest
        and revision.byte_size = p_byte_size
        and revision.mime_type = p_mime_type
    );
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.builder_retry_media_recovery_replica_v1(
  p_site_id uuid,
  p_media_id uuid,
  p_revision_id uuid,
  p_worker text,
  p_fence_token bigint,
  p_safe_code text,
  p_max_attempts integer default 8,
  p_at timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
begin
  if p_safe_code !~ '^[A-Z0-9_]{3,80}$' or p_max_attempts not between 1 and 20 then
    raise exception 'INVALID_MEDIA_RECOVERY_RETRY' using errcode = '22023';
  end if;
  update public.builder_media_recovery_replicas replica
  set status = case when replica.attempt_count >= p_max_attempts then 'failed' else 'pending' end,
      available_at = p_at + make_interval(secs => least(300, power(2, least(replica.attempt_count, 8))::integer)),
      lease_owner = null,
      lease_expires_at = null,
      last_error = p_safe_code,
      updated_at = p_at
  where replica.site_id = p_site_id
    and replica.media_id = p_media_id
    and replica.revision_id = p_revision_id
    and replica.status = 'pending'
    and replica.lease_owner = p_worker
    and replica.fence_token = p_fence_token
  returning replica.status into v_status;
  if v_status is null then return 'stale_fence'; end if;
  return v_status;
end;
$$;

create or replace function builder_private.assert_post_media_recoverable_v1(
  p_site_id uuid,
  p_snapshot jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_image jsonb;
begin
  for v_image in
    select image from (values
      (p_snapshot#>'{data,featuredImage}'),
      (p_snapshot#>'{data,seo,socialImage}')
    ) as candidate(image)
  loop
    if coalesce(v_image->>'kind', '') = 'managed' then
      begin
        if not exists (
          select 1 from public.builder_media_recovery_replicas replica
          where replica.site_id = p_site_id
            and replica.media_id = (v_image->>'mediaId')::uuid
            and replica.revision_id = (v_image->>'revisionId')::uuid
            and replica.status = 'ready'
        ) then
          raise exception 'MEDIA_RECOVERY_NOT_READY' using errcode = 'P0001';
        end if;
      exception when invalid_text_representation then
        raise exception 'INVALID_MANAGED_MEDIA_REFERENCE' using errcode = '22023';
      end;
    end if;
  end loop;
end;
$$;

create or replace function builder_private.enforce_post_publishable()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform builder_private.assert_post_publishable(new.snapshot);
  perform builder_private.assert_post_media_recoverable_v1(new.site_id, new.snapshot);
  return new;
end;
$$;

revoke all on function builder_private.enqueue_media_recovery_replica_v1() from public, anon, authenticated;
revoke all on function builder_private.assert_post_media_recoverable_v1(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.builder_claim_media_identity_v2(uuid, uuid, uuid, text, text, bigint, integer, integer, timestamptz) from public, anon;
revoke all on function public.builder_claim_media_recovery_replica_v1(text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.builder_complete_media_recovery_replica_v1(uuid, uuid, uuid, text, bigint, text, bigint, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.builder_retry_media_recovery_replica_v1(uuid, uuid, uuid, text, bigint, text, integer, timestamptz) from public, anon, authenticated;

grant execute on function public.builder_claim_media_identity_v2(uuid, uuid, uuid, text, text, bigint, integer, integer, timestamptz) to authenticated, service_role;
grant execute on function public.builder_claim_media_recovery_replica_v1(text, integer, timestamptz) to service_role;
grant execute on function public.builder_complete_media_recovery_replica_v1(uuid, uuid, uuid, text, bigint, text, bigint, text, text, timestamptz) to service_role;
grant execute on function public.builder_retry_media_recovery_replica_v1(uuid, uuid, uuid, text, bigint, text, integer, timestamptz) to service_role;
