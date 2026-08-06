-- Private, site-scoped media ingestion and exact post-availability contracts.
-- The application server is the only caller allowed to mutate orchestration records.

create table public.builder_media_identities (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  media_id uuid not null,
  byte_size bigint not null check (byte_size between 1 and 10485760),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  width integer not null check (width between 1 and 8192),
  height integer not null check (height between 1 and 8192),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (site_id, sha256),
  foreign key (site_id, media_id)
    references public.builder_media_assets(site_id, id) on delete restrict,
  check ((width::bigint * height::bigint) <= 40000000)
);

alter table public.builder_media_revisions
  add column sha256 text;

alter table public.builder_media_revisions
  add constraint builder_media_revisions_identity_fk
  foreign key (site_id, sha256)
  references public.builder_media_identities (site_id, sha256)
  deferrable initially deferred;

create table public.builder_media_inventory_receipts (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  status text not null check (status in ('scanning', 'succeeded', 'blocked')),
  asset_count integer not null default 0 check (asset_count >= 0),
  revision_count integer not null default 0 check (revision_count >= 0),
  digest_count integer not null default 0 check (digest_count >= 0),
  problems jsonb not null default '[]'::jsonb check (jsonb_typeof(problems) = 'array'),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  valid_until timestamptz,
  created_by uuid not null references auth.users(id),
  primary key (site_id, id),
  unique (site_id, id),
  check (
    (status = 'scanning' and completed_at is null and valid_until is null)
    or (status in ('succeeded', 'blocked') and completed_at is not null)
  ),
  check (status <> 'succeeded' or (jsonb_array_length(problems) = 0 and valid_until > completed_at))
);

create table public.builder_media_inventory_items (
  site_id uuid not null,
  receipt_id uuid not null,
  media_id uuid not null,
  revision_id uuid not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  object_key text not null,
  byte_size bigint not null check (byte_size between 1 and 10485760),
  mime_type text not null,
  width integer not null check (width between 1 and 8192),
  height integer not null check (height between 1 and 8192),
  result text not null check (result in ('verified', 'unreadable', 'invalid', 'digest_conflict')),
  problem text,
  created_at timestamptz not null default now(),
  primary key (site_id, receipt_id, revision_id),
  foreign key (site_id, receipt_id)
    references public.builder_media_inventory_receipts(site_id, id) on delete restrict,
  foreign key (site_id, media_id, revision_id)
    references public.builder_media_revisions(site_id, media_id, id) on delete restrict,
  check ((width::bigint * height::bigint) <= 40000000)
);

create table public.builder_media_import_manifests (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  status text not null default 'planning'
    check (status in ('planning', 'active', 'draining', 'completed', 'cancelled', 'expired', 'blocked')),
  source_label text not null check (length(source_label) between 1 and 200),
  source_manifest_sha256 text not null check (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  file_count integer not null check (file_count between 1 and 250),
  total_bytes bigint not null check (total_bytes between 1 and 262144000),
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  inventory_receipt_id uuid not null,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (site_id, id),
  unique (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, inventory_receipt_id)
    references public.builder_media_inventory_receipts(site_id, id) on delete restrict,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);

create unique index builder_media_one_active_batch_per_site
  on public.builder_media_import_manifests (site_id)
  where (status in ('planning', 'active', 'draining'));

create table public.builder_media_upload_plans (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  manifest_id uuid,
  mode text not null check (mode in ('single', 'batch')),
  status text not null default 'planned'
    check (status in (
      'planned', 'capability_issued', 'uploaded', 'finalized', 'deduplicated',
      'skipped_active', 'skipped_archived', 'rejected', 'expired',
      'cleanup_pending', 'cleaned'
    )),
  source_name text not null check (length(source_name) between 1 and 255),
  object_key text not null check (length(object_key) between 20 and 900 and object_key !~ '(^|/)\.\.(/|$)'),
  claimed_mime_type text not null,
  claimed_byte_size bigint not null check (claimed_byte_size between 1 and 10485760),
  claimed_width integer not null check (claimed_width between 1 and 8192),
  claimed_height integer not null check (claimed_height between 1 and 8192),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  capability_issued_at timestamptz,
  capability_expires_at timestamptz,
  object_uploaded_at timestamptz,
  verified_sha256 text check (verified_sha256 is null or verified_sha256 ~ '^[0-9a-f]{64}$'),
  verified_mime_type text,
  verified_byte_size bigint check (verified_byte_size is null or verified_byte_size between 1 and 10485760),
  verified_width integer check (verified_width is null or verified_width between 1 and 8192),
  verified_height integer check (verified_height is null or verified_height between 1 and 8192),
  media_id uuid,
  revision_id uuid,
  rejection_code text,
  cleanup_after timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, id),
  unique (site_id, idempotency_key),
  unique (object_key),
  foreign key (site_id, manifest_id)
    references public.builder_media_import_manifests(site_id, id) on delete restrict,
  foreign key (site_id, media_id)
    references public.builder_media_assets(site_id, id) on delete restrict,
  foreign key (site_id, media_id, revision_id)
    references public.builder_media_revisions(site_id, media_id, id) on delete restrict,
  check ((claimed_width::bigint * claimed_height::bigint) <= 40000000),
  check (
    verified_width is null or verified_height is null
    or (verified_width::bigint * verified_height::bigint) <= 40000000
  ),
  check ((mode = 'single' and manifest_id is null) or (mode = 'batch' and manifest_id is not null)),
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  check (capability_expires_at is null or capability_expires_at <= expires_at),
  check ((media_id is null and revision_id is null) or (media_id is not null and revision_id is not null))
);

create index builder_media_upload_plans_active_capability_idx
  on public.builder_media_upload_plans (site_id, capability_expires_at)
  where status in ('capability_issued', 'uploaded');

create table public.builder_media_capability_issuances (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  plan_id uuid not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  issued_by uuid not null references auth.users(id),
  primary key (site_id, id),
  foreign key (site_id, plan_id)
    references public.builder_media_upload_plans(site_id, id) on delete restrict,
  check (expires_at > issued_at and expires_at <= issued_at + interval '2 hours')
);

create index builder_media_capability_issuances_rate_idx
  on public.builder_media_capability_issuances (site_id, issued_at desc);

create table public.builder_media_import_receipts (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  manifest_id uuid not null,
  result text not null check (result in ('completed', 'completed_with_failures', 'cancelled', 'expired', 'blocked')),
  uploaded_count integer not null default 0 check (uploaded_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  archived_count integer not null default 0 check (archived_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  report jsonb not null check (jsonb_typeof(report) = 'array'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, manifest_id),
  foreign key (site_id, manifest_id)
    references public.builder_media_import_manifests(site_id, id) on delete restrict
);

create trigger builder_media_identities_immutable
before update or delete on public.builder_media_identities
for each row execute function builder_private.builder_reject_immutable_change();

create trigger builder_media_inventory_items_immutable
before update or delete on public.builder_media_inventory_items
for each row execute function builder_private.builder_reject_immutable_change();

create trigger builder_media_capability_issuances_immutable
before update or delete on public.builder_media_capability_issuances
for each row execute function builder_private.builder_reject_immutable_change();

create trigger builder_media_import_receipts_immutable
before update or delete on public.builder_media_import_receipts
for each row execute function builder_private.builder_reject_immutable_change();

create function builder_private.media_inventory_ready(
  p_site_id uuid,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select exists (
    select 1
    from public.builder_media_inventory_receipts receipt
    where receipt.site_id = p_site_id
      and receipt.status = 'succeeded'
      and receipt.completed_at is not null
      and receipt.valid_until > p_at
      and jsonb_array_length(receipt.problems) = 0
    order by receipt.completed_at desc
    limit 1
  );
$$;

create function builder_private.issue_media_upload_capability(
  p_site_id uuid,
  p_plan_id uuid,
  p_actor_id uuid,
  p_at timestamptz default now()
)
returns public.builder_media_upload_plans
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_plan public.builder_media_upload_plans%rowtype;
  v_manifest_expires_at timestamptz;
  v_active_capabilities integer;
  v_recent_issuances integer;
begin
  select * into v_plan
  from public.builder_media_upload_plans plan
  where plan.site_id = p_site_id and plan.id = p_plan_id
  for update;

  if not found or v_plan.created_by <> p_actor_id or v_plan.status <> 'planned' then
    raise exception 'media upload plan is not issuable' using errcode = 'P0001';
  end if;
  if not builder_private.media_inventory_ready(p_site_id, p_at) then
    raise exception 'current media inventory receipt required' using errcode = 'P0001';
  end if;
  if v_plan.expires_at <= p_at + interval '2 hours' then
    raise exception 'upload plan is inside its final two hours' using errcode = 'P0001';
  end if;

  if v_plan.manifest_id is not null then
    select manifest.expires_at into v_manifest_expires_at
    from public.builder_media_import_manifests manifest
    where manifest.site_id = p_site_id and manifest.id = v_plan.manifest_id
    for update;
    if v_manifest_expires_at is null or v_manifest_expires_at <= p_at + interval '2 hours' then
      raise exception 'import manifest is inside its final two hours' using errcode = 'P0001';
    end if;
  end if;

  select count(*) into v_active_capabilities
  from public.builder_media_upload_plans active_plan
  where active_plan.site_id = p_site_id
    and active_plan.status in ('capability_issued', 'uploaded')
    and active_plan.capability_expires_at > p_at;
  if v_active_capabilities >= 8 then
    raise exception 'active media capability limit exceeded' using errcode = 'P0001';
  end if;

  select count(*) into v_recent_issuances
  from public.builder_media_capability_issuances issuance
  where issuance.site_id = p_site_id
    and issuance.issued_at > p_at - interval '1 hour';
  if v_recent_issuances >= 300 then
    raise exception 'media capability issuance rate exceeded' using errcode = 'P0001';
  end if;

  update public.builder_media_upload_plans
  set status = 'capability_issued',
      capability_issued_at = p_at,
      capability_expires_at = least(expires_at, p_at + interval '2 hours'),
      updated_at = p_at
  where site_id = p_site_id and id = p_plan_id
  returning * into v_plan;

  insert into public.builder_media_capability_issuances (
    site_id, plan_id, issued_at, expires_at, issued_by
  ) values (
    p_site_id, p_plan_id, p_at, v_plan.capability_expires_at, p_actor_id
  );

  return v_plan;
end;
$$;

create function builder_private.claim_media_identity(
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
  v_plan public.builder_media_upload_plans%rowtype;
  v_existing public.builder_media_identities%rowtype;
  v_media_id uuid := gen_random_uuid();
  v_revision_id uuid := gen_random_uuid();
  v_inserted integer;
  v_archived_at timestamptz;
  v_result text;
begin
  if p_sha256 !~ '^[0-9a-f]{64}$'
    or p_byte_size not between 1 and 10485760
    or p_width not between 1 and 8192
    or p_height not between 1 and 8192
    or (p_width::bigint * p_height::bigint) > 40000000 then
    raise exception 'trusted media verification failed' using errcode = 'P0001';
  end if;

  select * into v_plan
  from public.builder_media_upload_plans plan
  where plan.site_id = p_site_id and plan.id = p_plan_id
  for update;
  if not found or v_plan.created_by <> p_actor_id
    or v_plan.status not in ('capability_issued', 'uploaded')
    or v_plan.capability_expires_at <= p_at
    or v_plan.expected_sha256 <> p_sha256 then
    raise exception 'media upload plan cannot be finalized' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_site_id::text || ':' || p_sha256, 0));
  select * into v_existing
  from public.builder_media_identities identity
  where identity.site_id = p_site_id and identity.sha256 = p_sha256;

  if found then
    select asset.archived_at into v_archived_at
    from public.builder_media_assets asset
    where asset.site_id = p_site_id and asset.id = v_existing.media_id;
    v_result := case
      when v_archived_at is not null then 'skipped_archived'
      when v_plan.object_uploaded_at is not null then 'deduplicated'
      else 'skipped_active'
    end;
    update public.builder_media_upload_plans
    set status = v_result,
        verified_sha256 = p_sha256,
        verified_mime_type = p_mime_type,
        verified_byte_size = p_byte_size,
        verified_width = p_width,
        verified_height = p_height,
        cleanup_after = case
          when object_uploaded_at is not null then greatest(capability_expires_at, p_at) + interval '15 minutes'
          else null
        end,
        updated_at = p_at
    where site_id = p_site_id and id = p_plan_id;
    return jsonb_build_object('status', v_result, 'mediaId', v_existing.media_id);
  end if;

  insert into public.builder_media_assets (site_id, id, label, created_by, created_at)
  values (p_site_id, v_media_id, v_plan.source_name, p_actor_id, p_at);

  insert into public.builder_media_identities (
    site_id, sha256, media_id, byte_size, mime_type, width, height, created_by, created_at
  ) values (
    p_site_id, p_sha256, v_media_id, p_byte_size, p_mime_type, p_width, p_height, p_actor_id, p_at
  )
  on conflict (site_id, sha256) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    delete from public.builder_media_assets
    where site_id = p_site_id and id = v_media_id
      and not exists (
        select 1 from public.builder_media_revisions revision
        where revision.site_id = p_site_id and revision.media_id = v_media_id
      );
    select * into v_existing
    from public.builder_media_identities identity
    where identity.site_id = p_site_id and identity.sha256 = p_sha256;
    update public.builder_media_upload_plans
    set status = 'deduplicated',
        cleanup_after = greatest(capability_expires_at, p_at) + interval '15 minutes',
        updated_at = p_at
    where site_id = p_site_id and id = p_plan_id;
    return jsonb_build_object('status', 'deduplicated', 'mediaId', v_existing.media_id);
  end if;

  insert into public.builder_media_revisions (
    site_id, media_id, id, object_key, mime_type, byte_size, width, height, created_by, created_at, sha256
  ) values (
    p_site_id, v_media_id, v_revision_id, v_plan.object_key, p_mime_type, p_byte_size,
    p_width, p_height, p_actor_id, p_at, p_sha256
  );

  update public.builder_media_upload_plans
  set status = 'finalized',
      verified_sha256 = p_sha256,
      verified_mime_type = p_mime_type,
      verified_byte_size = p_byte_size,
      verified_width = p_width,
      verified_height = p_height,
      media_id = v_media_id,
      revision_id = v_revision_id,
      cleanup_after = null,
      updated_at = p_at
  where site_id = p_site_id and id = p_plan_id;

  return jsonb_build_object('status', 'finalized', 'mediaId', v_media_id, 'revisionId', v_revision_id);
end;
$$;

create function builder_private.expire_media_upload_work(
  p_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_changed integer := 0;
  v_count integer := 0;
begin
  update public.builder_media_upload_plans
  set status = 'expired',
      cleanup_after = case
        when object_uploaded_at is not null
          then greatest(coalesce(capability_expires_at, p_at), p_at) + interval '15 minutes'
        else null
      end,
      updated_at = p_at
  where status in ('planned', 'capability_issued', 'uploaded')
    and expires_at <= p_at;
  get diagnostics v_count = row_count;
  v_changed := v_changed + v_count;

  update public.builder_media_import_manifests manifest
  set status = case
        when exists (
          select 1 from public.builder_media_upload_plans plan
          where plan.site_id = manifest.site_id and plan.manifest_id = manifest.id
            and plan.status in ('capability_issued', 'uploaded')
            and plan.capability_expires_at > p_at
        ) then 'draining'
        else 'expired'
      end,
      completed_at = case
        when not exists (
          select 1 from public.builder_media_upload_plans plan
          where plan.site_id = manifest.site_id and plan.manifest_id = manifest.id
            and plan.status in ('capability_issued', 'uploaded')
            and plan.capability_expires_at > p_at
        ) then p_at
        else null
      end
  where manifest.status in ('planning', 'active', 'draining')
    and manifest.expires_at <= p_at;
  get diagnostics v_count = row_count;
  return v_changed + v_count;
end;
$$;

create function builder_private.claim_media_cleanup(
  p_at timestamptz default now()
)
returns setof public.builder_media_upload_plans
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
begin
  return query
  with candidates as (
    select plan.site_id, plan.id
    from public.builder_media_upload_plans plan
    where plan.status in ('rejected', 'deduplicated', 'expired')
      and plan.object_uploaded_at is not null
      and plan.cleanup_after <= p_at
      and plan.revision_id is null
      and not exists (
        select 1 from public.builder_media_revisions revision
        where revision.object_key = plan.object_key
      )
    order by plan.cleanup_after, plan.id
    for update skip locked
    limit 100
  )
  update public.builder_media_upload_plans plan
  set status = 'cleanup_pending', updated_at = p_at
  from candidates
  where plan.site_id = candidates.site_id and plan.id = candidates.id
  returning plan.*;
end;
$$;

create function public.builder_issue_media_upload_capability(
  p_site_id uuid,
  p_plan_id uuid,
  p_actor_id uuid,
  p_at timestamptz default now()
)
returns public.builder_media_upload_plans
language sql
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select builder_private.issue_media_upload_capability(
    p_site_id, p_plan_id, p_actor_id, p_at
  );
$$;

create function public.builder_claim_media_identity(
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
language sql
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select builder_private.claim_media_identity(
    p_site_id, p_plan_id, p_actor_id, p_sha256, p_mime_type,
    p_byte_size, p_width, p_height, p_at
  );
$$;

create or replace function public.builder_post_is_available(
  p_site_id uuid,
  p_entry_id uuid,
  p_version_id uuid,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.builder_entries entry
    join public.builder_entry_versions version
      on version.site_id = entry.site_id
      and version.entry_id = entry.id
      and version.id = p_version_id
    where entry.site_id = p_site_id
      and entry.id = p_entry_id
      and entry.content_type = 'post'
      and entry.status = 'published'
      and entry.active_published_version_id = p_version_id
      and entry.first_published_at is not null
      and entry.first_published_at <= p_at
      and version.display_date <= p_at
      and (version.expires_at is null or version.expires_at > p_at)
  );
$$;

create or replace view public.builder_public_posts
with (security_invoker = true)
as
select
  published.site_id,
  published.entry_id,
  published.version_id,
  published.slug,
  published.title,
  published.excerpt,
  published.snapshot,
  published.category_keys,
  published.tag_keys,
  published.display_date,
  published.first_published_at,
  published.version_published_at,
  published.expires_at,
  published.featured,
  published.pinned
from public.builder_published_entries published
where public.builder_post_is_available(published.site_id, published.entry_id, published.version_id, now());

alter table public.builder_media_identities enable row level security;
alter table public.builder_media_inventory_receipts enable row level security;
alter table public.builder_media_inventory_items enable row level security;
alter table public.builder_media_import_manifests enable row level security;
alter table public.builder_media_upload_plans enable row level security;
alter table public.builder_media_capability_issuances enable row level security;
alter table public.builder_media_import_receipts enable row level security;

revoke all on public.builder_media_identities from anon, authenticated;
revoke all on public.builder_media_inventory_receipts from anon, authenticated;
revoke all on public.builder_media_inventory_items from anon, authenticated;
revoke all on public.builder_media_import_manifests from anon, authenticated;
revoke all on public.builder_media_upload_plans from anon, authenticated;
revoke all on public.builder_media_capability_issuances from anon, authenticated;
revoke all on public.builder_media_import_receipts from anon, authenticated;

grant all on public.builder_media_identities to service_role;
grant all on public.builder_media_inventory_receipts to service_role;
grant all on public.builder_media_inventory_items to service_role;
grant all on public.builder_media_import_manifests to service_role;
grant all on public.builder_media_upload_plans to service_role;
grant all on public.builder_media_capability_issuances to service_role;
grant all on public.builder_media_import_receipts to service_role;

revoke all on function builder_private.media_inventory_ready(uuid, timestamptz) from public, anon, authenticated;
revoke all on function builder_private.issue_media_upload_capability(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function builder_private.claim_media_identity(uuid, uuid, uuid, text, text, bigint, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function builder_private.expire_media_upload_work(timestamptz) from public, anon, authenticated;
revoke all on function builder_private.claim_media_cleanup(timestamptz) from public, anon, authenticated;
revoke all on function public.builder_issue_media_upload_capability(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.builder_claim_media_identity(uuid, uuid, uuid, text, text, bigint, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.builder_issue_media_upload_capability(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.builder_claim_media_identity(uuid, uuid, uuid, text, text, bigint, integer, integer, timestamptz) to service_role;
grant execute on function public.builder_post_is_available(uuid, uuid, uuid, timestamptz) to anon, authenticated, service_role;

insert into storage.buckets (id, name, public)
values ('builder-media', 'builder-media', false)
on conflict (id) do update set public = false;

drop policy if exists builder_media_member_upload on storage.objects;
