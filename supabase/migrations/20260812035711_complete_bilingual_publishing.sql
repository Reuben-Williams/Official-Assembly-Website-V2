-- Complete bilingual publishing is additive and inactive by default.
-- Browser roles may inspect authorized authoring records but cannot mutate the
-- composition boundary or invoke trusted publication functions.

create or replace function builder_private.builder_canonical_json(p_value jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, builder_private
as $$
  select case jsonb_typeof(p_value)
    when 'object' then (
      select '{' || coalesce(string_agg(
        to_jsonb(entry.key)::text || ':' || builder_private.builder_canonical_json(entry.value),
        ',' order by entry.key collate "C"
      ), '') || '}'
      from jsonb_each(p_value) entry
    )
    when 'array' then (
      select '[' || coalesce(string_agg(
        builder_private.builder_canonical_json(item.value),
        ',' order by item.ordinality
      ), '') || ']'
      from jsonb_array_elements(p_value) with ordinality item(value, ordinality)
    )
    else p_value::text
  end;
$$;

create or replace function builder_private.builder_sha256_json(p_value jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, extensions, builder_private
as $$
  select encode(
    extensions.digest(
      convert_to(builder_private.builder_canonical_json(p_value), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function builder_private.builder_validate_localized_text_v1(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, builder_private
as $$
declare
  v_es jsonb;
  v_expected_source text;
  v_expected_detail text;
  v_mode text;
  v_status text;
begin
  if jsonb_typeof(p_value) <> 'object'
    or p_value ->> 'schemaVersion' <> '1'
    or coalesce(char_length(p_value ->> 'fieldId'), 0) not between 1 and 500
    or p_value ->> 'fieldId' !~ '^[a-zA-Z0-9]+([.:-][a-zA-Z0-9]+)*$'
    or coalesce(char_length(btrim(p_value ->> 'en')), 0) not between 1 and 100000
    or (p_value ->> 'en') like '%' || chr(13) || '%'
    or jsonb_typeof(p_value -> 'es') <> 'object' then
    raise exception 'LOCALIZATION_VALUE_INVALID' using errcode = '22023';
  end if;

  v_es := p_value -> 'es';
  v_expected_source := builder_private.builder_sha256_json(jsonb_build_object(
    'schemaVersion', 1,
    'fieldId', p_value ->> 'fieldId',
    'en', p_value ->> 'en'
  ));
  if v_es ->> 'sourceDigest' <> v_expected_source then
    raise exception 'LOCALIZATION_SOURCE_DIGEST_STALE' using errcode = '22023';
  end if;

  v_mode := v_es ->> 'mode';
  if v_mode = 'missing' then
    return false;
  end if;

  v_status := v_es ->> 'status';
  if v_mode = 'translated' then
    if v_status not in ('draft', 'needs_review', 'approved')
      or v_es ->> 'origin' not in ('manual', 'generated', 'migrated')
      or coalesce(char_length(btrim(v_es ->> 'value')), 0) not between 1 and 100000
      or coalesce(char_length(v_es ->> 'updatedBy'), 0) not between 1 and 200
      or coalesce(v_es ->> 'updatedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then
      raise exception 'LOCALIZATION_TRANSLATION_INVALID' using errcode = '22023';
    end if;
    if v_status <> 'approved' then
      return false;
    end if;
    if coalesce(char_length(v_es ->> 'approvedBy'), 0) not between 1 and 200
      or coalesce(v_es ->> 'approvedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then
      raise exception 'LOCALIZATION_APPROVAL_INVALID' using errcode = '22023';
    end if;
    v_expected_detail := builder_private.builder_sha256_json(jsonb_build_object(
      'schemaVersion', 1,
      'fieldId', p_value ->> 'fieldId',
      'sourceDigest', v_expected_source,
      'value', v_es ->> 'value',
      'origin', v_es ->> 'origin'
    ));
    if v_es ->> 'translationDigest' <> v_expected_detail then
      raise exception 'LOCALIZATION_TRANSLATION_DIGEST_STALE' using errcode = '22023';
    end if;
    return true;
  end if;

  if v_mode <> 'language_neutral'
    or v_status not in ('needs_review', 'approved')
    or v_es ->> 'reasonCode' not in (
      'proper_name', 'official_title', 'address', 'phone', 'date', 'identifier'
    )
    or coalesce(char_length(btrim(v_es ->> 'explanation')), 0) not between 1 and 2000 then
    raise exception 'LOCALIZATION_EXEMPTION_INVALID' using errcode = '22023';
  end if;
  if v_status <> 'approved' then
    if coalesce(char_length(v_es ->> 'requestedBy'), 0) not between 1 and 200
      or coalesce(v_es ->> 'requestedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then
      raise exception 'LOCALIZATION_EXEMPTION_REQUEST_INVALID' using errcode = '22023';
    end if;
    return false;
  end if;
  if coalesce(char_length(v_es ->> 'approvedBy'), 0) not between 1 and 200
    or coalesce(v_es ->> 'approvedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then
    raise exception 'LOCALIZATION_EXEMPTION_APPROVAL_INVALID' using errcode = '22023';
  end if;
  v_expected_detail := builder_private.builder_sha256_json(jsonb_build_object(
    'schemaVersion', 1,
    'fieldId', p_value ->> 'fieldId',
    'sourceDigest', v_expected_source,
    'reasonCode', v_es ->> 'reasonCode',
    'explanation', v_es ->> 'explanation'
  ));
  if v_es ->> 'exemptionDigest' <> v_expected_detail then
    raise exception 'LOCALIZATION_EXEMPTION_DIGEST_STALE' using errcode = '22023';
  end if;
  return true;
end;
$$;

create or replace function builder_private.builder_validate_localized_snapshot_v1(p_snapshot jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, builder_private
as $$
declare
  v_field jsonb;
  v_text jsonb;
  v_ready boolean := true;
  v_field_ids text[] := array[]::text[];
begin
  if jsonb_typeof(p_snapshot) <> 'object'
    or p_snapshot ->> 'schemaVersion' <> '1'
    or p_snapshot ->> 'domain' not in ('site', 'post', 'alerts', 'form', 'media', 'email')
    or jsonb_typeof(p_snapshot -> 'fields') <> 'array' then
    raise exception 'LOCALIZATION_SNAPSHOT_INVALID' using errcode = '22023';
  end if;

  for v_field in select value from jsonb_array_elements(p_snapshot -> 'fields')
  loop
    if v_field ->> 'kind' = 'text' then
      v_text := v_field -> 'value';
      if v_text ->> 'fieldId' = any(v_field_ids) then
        raise exception 'LOCALIZATION_FIELD_DUPLICATE' using errcode = '22023';
      end if;
      v_field_ids := array_append(v_field_ids, v_text ->> 'fieldId');
      if not builder_private.builder_validate_localized_text_v1(v_text) then
        v_ready := false;
      end if;
    elsif v_field ->> 'kind' = 'rich_text' then
      if jsonb_typeof(v_field -> 'value') <> 'object'
        or coalesce(char_length(v_field #>> '{value,fieldId}'), 0) not between 1 and 500
        or jsonb_typeof(v_field #> '{value,structure}') <> 'object'
        or jsonb_typeof(v_field #> '{value,text}') <> 'object'
        or v_field #>> '{value,structureDigest}' <>
          builder_private.builder_sha256_json(v_field #> '{value,structure}') then
        raise exception 'LOCALIZATION_RICH_TEXT_INVALID' using errcode = '22023';
      end if;
      if v_field #>> '{value,fieldId}' = any(v_field_ids) then
        raise exception 'LOCALIZATION_FIELD_DUPLICATE' using errcode = '22023';
      end if;
      v_field_ids := array_append(v_field_ids, v_field #>> '{value,fieldId}');
      for v_text in select value from jsonb_each(v_field #> '{value,text}')
      loop
        if not builder_private.builder_validate_localized_text_v1(v_text) then
          v_ready := false;
        end if;
      end loop;
    else
      raise exception 'LOCALIZATION_FIELD_KIND_INVALID' using errcode = '22023';
    end if;
  end loop;
  return v_ready;
end;
$$;

create table public.builder_localized_domain_revisions (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  domain text not null check (domain in ('site', 'post', 'alerts', 'form', 'media', 'email')),
  stable_id text not null check (
    char_length(stable_id) between 1 and 500
    and stable_id ~ '^[a-zA-Z0-9]+([._:-][a-zA-Z0-9]+)*$'
  ),
  revision_id uuid not null,
  parent_revision_id uuid,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_digest text not null check (snapshot_digest ~ '^[a-f0-9]{64}$'),
  bilingual_ready boolean not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (site_id, domain, stable_id, revision_id),
  unique (site_id, revision_id),
  foreign key (site_id, domain, stable_id, parent_revision_id)
    references public.builder_localized_domain_revisions(site_id, domain, stable_id, revision_id)
    on delete restrict
);

create index builder_localized_domain_revisions_item_created_idx
  on public.builder_localized_domain_revisions
  (site_id, domain, stable_id, created_at desc, revision_id desc);
create index builder_localized_domain_revisions_readiness_idx
  on public.builder_localized_domain_revisions (site_id, bilingual_ready, domain, stable_id);

create or replace function builder_private.builder_prepare_localized_revision_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
begin
  if new.snapshot ->> 'siteId' <> new.site_id::text
    or new.snapshot ->> 'domain' <> new.domain
    or new.snapshot ->> 'stableId' <> new.stable_id
    or new.snapshot ->> 'revisionId' <> new.revision_id::text
    or coalesce(new.snapshot ->> 'parentRevisionId', '') <>
      coalesce(new.parent_revision_id::text, '')
    or new.snapshot ->> 'createdBy' <> new.created_by::text
    or (new.snapshot ->> 'createdAt')::timestamptz <> new.created_at then
    raise exception 'LOCALIZATION_REVISION_IDENTITY_MISMATCH' using errcode = '22023';
  end if;
  if new.snapshot_digest <> builder_private.builder_sha256_json(new.snapshot) then
    raise exception 'LOCALIZATION_SNAPSHOT_DIGEST_STALE' using errcode = '22023';
  end if;
  new.bilingual_ready := builder_private.builder_validate_localized_snapshot_v1(new.snapshot);
  return new;
exception
  when invalid_datetime_format then
    raise exception 'LOCALIZATION_REVISION_TIME_INVALID' using errcode = '22023';
end;
$$;

create trigger builder_localized_domain_revisions_prepare
before insert on public.builder_localized_domain_revisions
for each row execute function builder_private.builder_prepare_localized_revision_v1();

create trigger builder_localized_domain_revisions_immutable
before update or delete on public.builder_localized_domain_revisions
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_domain_publication_manifests (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  publication_id uuid not null,
  domain text not null check (domain in ('site', 'post', 'alerts', 'form', 'media', 'email')),
  stable_id text not null check (char_length(stable_id) between 1 and 500),
  primary_revision_id uuid not null,
  dependency_revisions jsonb not null default '[]'::jsonb check (jsonb_typeof(dependency_revisions) = 'array'),
  manifest_digest text not null check (manifest_digest ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (site_id, publication_id),
  unique (site_id, domain, stable_id, publication_id),
  foreign key (site_id, primary_revision_id)
    references public.builder_localized_domain_revisions(site_id, revision_id) on delete restrict
);

create index builder_domain_publication_manifests_item_created_idx
  on public.builder_domain_publication_manifests
  (site_id, domain, stable_id, created_at desc, publication_id desc);

create or replace function builder_private.builder_validate_domain_manifest_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_primary public.builder_localized_domain_revisions%rowtype;
  v_dependency jsonb;
  v_expected text;
begin
  select * into v_primary
  from public.builder_localized_domain_revisions
  where site_id = new.site_id and revision_id = new.primary_revision_id;
  if not found then
    raise foreign_key_violation using message = 'domain publication primary revision is absent';
  end if;
  if v_primary.domain <> new.domain or v_primary.stable_id <> new.stable_id
    or not v_primary.bilingual_ready then
    raise exception 'DOMAIN_PUBLICATION_NOT_READY' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.dependency_revisions) item
    where jsonb_typeof(item) <> 'string'
       or (item #>> '{}') !~ '^[0-9a-fA-F-]{36}$'
  ) or exists (
    select 1 from jsonb_array_elements_text(new.dependency_revisions) dependency_id
    group by dependency_id having count(*) > 1
  ) then
    raise exception 'DOMAIN_PUBLICATION_DEPENDENCIES_INVALID' using errcode = '22023';
  end if;
  for v_dependency in select value from jsonb_array_elements(new.dependency_revisions)
  loop
    if not exists (
      select 1 from public.builder_localized_domain_revisions revision
      where revision.site_id = new.site_id
        and revision.revision_id = (v_dependency #>> '{}')::uuid
        and revision.bilingual_ready
    ) then
      raise exception 'DOMAIN_PUBLICATION_DEPENDENCY_NOT_READY' using errcode = '23514';
    end if;
  end loop;
  v_expected := builder_private.builder_sha256_json(jsonb_build_object(
    'schemaVersion', 1,
    'siteId', new.site_id,
    'publicationId', new.publication_id,
    'domain', new.domain,
    'stableId', new.stable_id,
    'primaryRevisionId', new.primary_revision_id,
    'dependencyRevisionIds', new.dependency_revisions,
    'createdBy', new.created_by,
    'createdAt', to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ));
  if new.manifest_digest <> v_expected then
    raise exception 'DOMAIN_PUBLICATION_DIGEST_STALE' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger builder_domain_publication_manifests_validate
before insert on public.builder_domain_publication_manifests
for each row execute function builder_private.builder_validate_domain_manifest_v1();

create trigger builder_domain_publication_manifests_immutable
before update or delete on public.builder_domain_publication_manifests
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_site_compositions (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  composition_id uuid not null,
  composition_digest text not null check (composition_digest ~ '^[a-f0-9]{64}$'),
  base_composition_id uuid,
  intended_delta jsonb,
  global_region_revision_id uuid not null,
  catalog_revision text not null check (char_length(catalog_revision) between 1 and 500),
  catalog_public_digest text not null check (catalog_public_digest ~ '^[a-f0-9]{64}$'),
  domain_publications jsonb not null check (jsonb_typeof(domain_publications) = 'array'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (site_id, composition_id),
  unique (site_id, composition_id, composition_digest),
  foreign key (site_id, base_composition_id)
    references public.builder_site_compositions(site_id, composition_id) on delete restrict,
  foreign key (site_id, global_region_revision_id)
    references public.builder_localized_domain_revisions(site_id, revision_id) on delete restrict,
  check ((base_composition_id is null) = (intended_delta is null))
);

create index builder_site_compositions_created_idx
  on public.builder_site_compositions (site_id, created_at desc, composition_id desc);

create or replace function builder_private.builder_composition_payload_v1(
  p_site_id uuid,
  p_composition_id uuid,
  p_base_composition_id uuid,
  p_intended_delta jsonb,
  p_global_region_revision_id uuid,
  p_catalog_revision text,
  p_catalog_public_digest text,
  p_domain_publications jsonb,
  p_created_at timestamptz
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'siteId', p_site_id,
    'compositionId', p_composition_id,
    'baseCompositionId', p_base_composition_id,
    'intendedDelta', p_intended_delta,
    'globalRegionRevisionId', p_global_region_revision_id,
    'catalogRevision', p_catalog_revision,
    'catalogPublicDigest', p_catalog_public_digest,
    'domainPublications', p_domain_publications,
    'createdAt', to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

create or replace function builder_private.builder_validate_site_composition_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_reference jsonb;
  v_manifest public.builder_domain_publication_manifests%rowtype;
  v_global_ready boolean;
  v_expected text;
begin
  select bilingual_ready into v_global_ready
  from public.builder_localized_domain_revisions
  where site_id = new.site_id and revision_id = new.global_region_revision_id
    and domain = 'site';
  if not coalesce(v_global_ready, false) then
    raise exception 'COMPOSITION_GLOBAL_REGION_NOT_READY' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.domain_publications) reference
    group by reference ->> 'domain', reference ->> 'stableId'
    having count(*) > 1
  ) then
    raise exception 'COMPOSITION_DOMAIN_DUPLICATE' using errcode = '22023';
  end if;
  for v_reference in select value from jsonb_array_elements(new.domain_publications)
  loop
    if jsonb_typeof(v_reference) <> 'object'
      or v_reference ->> 'domain' not in ('site', 'post', 'alerts', 'form', 'media', 'email')
      or coalesce(char_length(v_reference ->> 'stableId'), 0) not between 1 and 500
      or coalesce(v_reference ->> 'publicationId', '') !~ '^[0-9a-fA-F-]{36}$'
      or coalesce(v_reference ->> 'digest', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'COMPOSITION_DOMAIN_REFERENCE_INVALID' using errcode = '22023';
    end if;
    select * into v_manifest
    from public.builder_domain_publication_manifests
    where site_id = new.site_id
      and publication_id = (v_reference ->> 'publicationId')::uuid;
    if not found
      or v_manifest.domain <> v_reference ->> 'domain'
      or v_manifest.stable_id <> v_reference ->> 'stableId'
      or v_manifest.manifest_digest <> v_reference ->> 'digest' then
      raise exception 'COMPOSITION_DOMAIN_REFERENCE_STALE' using errcode = '23514';
    end if;
  end loop;
  v_expected := builder_private.builder_sha256_json(
    builder_private.builder_composition_payload_v1(
      new.site_id,
      new.composition_id,
      new.base_composition_id,
      new.intended_delta,
      new.global_region_revision_id,
      new.catalog_revision,
      new.catalog_public_digest,
      new.domain_publications,
      new.created_at
    )
  );
  if new.composition_digest <> v_expected then
    raise exception 'COMPOSITION_DIGEST_STALE' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger builder_site_compositions_validate
before insert on public.builder_site_compositions
for each row execute function builder_private.builder_validate_site_composition_v1();

create trigger builder_site_compositions_immutable
before update or delete on public.builder_site_compositions
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_site_publication_state (
  site_id uuid primary key references public.builder_sites(id) on delete restrict,
  published_composition_id uuid,
  published_sequence bigint not null default 0 check (published_sequence >= 0),
  bilingual_active boolean not null default false,
  activation_epoch_id uuid,
  lock_version bigint not null default 0 check (lock_version >= 0),
  updated_at timestamptz not null default now(),
  foreign key (site_id, published_composition_id)
    references public.builder_site_compositions(site_id, composition_id) on delete restrict,
  check ((published_composition_id is null) = (published_sequence = 0)),
  check (not bilingual_active or published_composition_id is not null)
);

create table public.builder_site_composition_publications (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  publication_sequence bigint not null check (publication_sequence > 0),
  composition_id uuid not null,
  composition_digest text not null check (composition_digest ~ '^[a-f0-9]{64}$'),
  predecessor_composition_id uuid,
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  primary key (site_id, publication_sequence),
  unique (site_id, composition_id),
  foreign key (site_id, composition_id, composition_digest)
    references public.builder_site_compositions(site_id, composition_id, composition_digest) on delete restrict,
  foreign key (site_id, predecessor_composition_id)
    references public.builder_site_compositions(site_id, composition_id) on delete restrict
);

create index builder_site_composition_publications_created_idx
  on public.builder_site_composition_publications
  (site_id, published_at desc, publication_sequence desc);

create trigger builder_site_composition_publications_immutable
before update or delete on public.builder_site_composition_publications
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_composition_idempotency_results (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  operation text not null check (operation in ('initialize', 'stage_domain', 'publish', 'restore', 'activate')),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  safe_result jsonb not null check (jsonb_typeof(safe_result) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (site_id, idempotency_key),
  check (expires_at >= created_at + interval '90 days')
);

create index builder_composition_idempotency_results_expiry_idx
  on public.builder_composition_idempotency_results (expires_at, site_id);

create trigger builder_composition_idempotency_results_immutable
before update or delete on public.builder_composition_idempotency_results
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_bilingual_activation_epochs (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  epoch_id uuid not null,
  composition_id uuid not null,
  composition_digest text not null check (composition_digest ~ '^[a-f0-9]{64}$'),
  inventory_digest text not null check (inventory_digest ~ '^[a-f0-9]{64}$'),
  catalog_revision text not null check (char_length(catalog_revision) between 1 and 500),
  catalog_public_digest text not null check (catalog_public_digest ~ '^[a-f0-9]{64}$'),
  application_release text not null check (char_length(application_release) between 1 and 200),
  package_versions jsonb not null check (jsonb_typeof(package_versions) = 'object'),
  migration_set jsonb not null check (jsonb_typeof(migration_set) = 'array'),
  activated_by uuid not null references auth.users(id) on delete restrict,
  activated_at timestamptz not null default now(),
  primary key (site_id, epoch_id),
  unique (site_id, composition_id, epoch_id),
  foreign key (site_id, composition_id, composition_digest)
    references public.builder_site_compositions(site_id, composition_id, composition_digest) on delete restrict
);

create trigger builder_bilingual_activation_epochs_immutable
before update or delete on public.builder_bilingual_activation_epochs
for each row execute function builder_private.builder_reject_immutable_change();

alter table public.builder_site_publication_state
  add foreign key (site_id, activation_epoch_id)
    references public.builder_bilingual_activation_epochs(site_id, epoch_id) on delete restrict;

create table public.builder_site_composition_recovery_artifacts (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  composition_id uuid not null,
  composition_digest text not null check (composition_digest ~ '^[a-f0-9]{64}$'),
  predecessor_composition_id uuid,
  publication_sequence bigint not null check (publication_sequence > 0),
  artifact jsonb not null check (jsonb_typeof(artifact) = 'object'),
  artifact_digest text not null check (artifact_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (site_id, publication_sequence),
  unique (site_id, composition_id),
  foreign key (site_id, composition_id, composition_digest)
    references public.builder_site_compositions(site_id, composition_id, composition_digest) on delete restrict,
  foreign key (site_id, predecessor_composition_id)
    references public.builder_site_compositions(site_id, composition_id) on delete restrict,
  check (expires_at >= created_at + interval '90 days')
);

create index builder_site_composition_recovery_artifacts_retained_idx
  on public.builder_site_composition_recovery_artifacts
  (site_id, publication_sequence desc, expires_at desc);

create trigger builder_site_composition_recovery_artifacts_immutable
before update or delete on public.builder_site_composition_recovery_artifacts
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_site_composition_recovery_pointer (
  site_id uuid primary key references public.builder_sites(id) on delete restrict,
  publication_sequence bigint not null check (publication_sequence > 0),
  composition_id uuid not null,
  composition_digest text not null check (composition_digest ~ '^[a-f0-9]{64}$'),
  artifact_digest text not null check (artifact_digest ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now(),
  foreign key (site_id, publication_sequence)
    references public.builder_site_composition_recovery_artifacts(site_id, publication_sequence) on delete restrict,
  foreign key (site_id, composition_id)
    references public.builder_site_composition_recovery_artifacts(site_id, composition_id) on delete restrict
);

create table public.builder_site_composition_recovery_jobs (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  publication_sequence bigint not null check (publication_sequence > 0),
  composition_id uuid not null,
  composition_digest text not null check (composition_digest ~ '^[a-f0-9]{64}$'),
  predecessor_composition_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'retry', 'completed', 'dead_letter', 'superseded')),
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  fence_token bigint not null default 0 check (fence_token >= 0),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, publication_sequence),
  foreign key (site_id, publication_sequence)
    references public.builder_site_composition_publications(site_id, publication_sequence) on delete restrict,
  foreign key (site_id, composition_id, composition_digest)
    references public.builder_site_compositions(site_id, composition_id, composition_digest) on delete restrict,
  foreign key (site_id, predecessor_composition_id)
    references public.builder_site_compositions(site_id, composition_id) on delete restrict,
  check ((lease_owner is null) = (lease_expires_at is null)),
  check (status = 'claimed' or lease_owner is null)
);

create index builder_site_composition_recovery_jobs_due_idx
  on public.builder_site_composition_recovery_jobs
  (available_at, site_id, publication_sequence)
  where status in ('pending', 'retry');

create or replace function builder_private.builder_composition_actor_v1(
  p_site_id uuid,
  p_actor_id uuid,
  p_roles text[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
begin
  if p_actor_id is null or not exists (
    select 1 from public.builder_site_members member
    where member.site_id = p_site_id
      and member.user_id = p_actor_id
      and member.role = any(p_roles)
  ) then
    raise exception 'COMPOSITION_COMMAND_DENIED' using errcode = '42501';
  end if;
end;
$$;

create or replace function builder_private.builder_composition_idempotency_replay_v1(
  p_site_id uuid,
  p_idempotency_key text,
  p_operation text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_existing public.builder_composition_idempotency_results%rowtype;
begin
  select * into v_existing
  from public.builder_composition_idempotency_results
  where site_id = p_site_id and idempotency_key = p_idempotency_key;
  if not found then return null; end if;
  if v_existing.operation <> p_operation or v_existing.request_hash <> p_request_hash then
    raise exception 'IDEMPOTENCY_MISMATCH' using errcode = '23505';
  end if;
  return v_existing.safe_result;
end;
$$;

create or replace function builder_private.builder_record_composition_idempotency_v1(
  p_site_id uuid,
  p_idempotency_key text,
  p_operation text,
  p_request_hash text,
  p_safe_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
begin
  insert into public.builder_composition_idempotency_results (
    site_id, idempotency_key, operation, request_hash, safe_result, expires_at
  ) values (
    p_site_id, p_idempotency_key, p_operation, p_request_hash,
    p_safe_result, statement_timestamp() + interval '90 days'
  );
  return p_safe_result;
exception
  when unique_violation then
    return builder_private.builder_composition_idempotency_replay_v1(
      p_site_id, p_idempotency_key, p_operation, p_request_hash
    );
end;
$$;

create or replace function public.builder_stage_domain_composition_v1(
  p_site_id uuid,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_actor_id uuid;
  v_idempotency_key text;
  v_request_hash text;
  v_replay jsonb;
  v_expected_lock bigint;
  v_expected_current uuid;
  v_state public.builder_site_publication_state%rowtype;
  v_current public.builder_site_compositions%rowtype;
  v_revision public.builder_localized_domain_revisions%rowtype;
  v_revision_found boolean := false;
  v_publication_id uuid := gen_random_uuid();
  v_composition_id uuid := gen_random_uuid();
  v_manifest_created_at timestamptz := statement_timestamp();
  v_composition_created_at timestamptz := statement_timestamp();
  v_dependencies jsonb;
  v_manifest_digest text;
  v_global_revision_id uuid;
  v_catalog_revision text;
  v_catalog_digest text;
  v_domain_publications jsonb;
  v_intended_delta jsonb;
  v_composition_digest text;
  v_result jsonb;
begin
  if jsonb_typeof(p_request) <> 'object' then
    raise exception 'COMPOSITION_REQUEST_INVALID' using errcode = '22023';
  end if;
  begin
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_expected_lock := (p_request ->> 'expectedLockVersion')::bigint;
    v_expected_current := nullif(p_request ->> 'expectedCurrentCompositionId', '')::uuid;
    select * into v_revision
    from public.builder_localized_domain_revisions
    where site_id = p_site_id
      and revision_id = (p_request ->> 'candidateRevisionId')::uuid;
    v_revision_found := found;
  exception when invalid_text_representation then
    raise exception 'COMPOSITION_REQUEST_INVALID' using errcode = '22023';
  end;
  v_idempotency_key := p_request ->> 'idempotencyKey';
  if coalesce(char_length(v_idempotency_key), 0) not between 1 and 200
    or v_expected_lock < 0
    or not v_revision_found then
    raise exception 'COMPOSITION_REQUEST_INVALID' using errcode = '22023';
  end if;
  v_request_hash := builder_private.builder_sha256_json(p_request);
  v_replay := builder_private.builder_composition_idempotency_replay_v1(
    p_site_id, v_idempotency_key, 'stage_domain', v_request_hash
  );
  if v_replay is not null then return v_replay; end if;
  perform builder_private.builder_composition_actor_v1(
    p_site_id, v_actor_id, array['owner', 'editor', 'contributor']
  );
  if not v_revision.bilingual_ready then
    raise exception 'DOMAIN_PUBLICATION_NOT_READY' using errcode = '23514';
  end if;

  insert into public.builder_site_publication_state (site_id)
  values (p_site_id)
  on conflict (site_id) do nothing;
  select * into v_state
  from public.builder_site_publication_state
  where site_id = p_site_id for update;
  if v_state.lock_version <> v_expected_lock
    or v_state.published_composition_id is distinct from v_expected_current then
    raise exception 'STALE_COMPOSITION' using errcode = '40001';
  end if;

  v_dependencies := coalesce(p_request -> 'dependencyRevisionIds', '[]'::jsonb);
  if jsonb_typeof(v_dependencies) <> 'array' then
    raise exception 'COMPOSITION_REQUEST_INVALID' using errcode = '22023';
  end if;
  v_manifest_digest := builder_private.builder_sha256_json(jsonb_build_object(
    'schemaVersion', 1,
    'siteId', p_site_id,
    'publicationId', v_publication_id,
    'domain', v_revision.domain,
    'stableId', v_revision.stable_id,
    'primaryRevisionId', v_revision.revision_id,
    'dependencyRevisionIds', v_dependencies,
    'createdBy', v_actor_id,
    'createdAt', to_char(v_manifest_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ));
  insert into public.builder_domain_publication_manifests (
    site_id, publication_id, domain, stable_id, primary_revision_id,
    dependency_revisions, manifest_digest, created_by, created_at
  ) values (
    p_site_id, v_publication_id, v_revision.domain, v_revision.stable_id,
    v_revision.revision_id, v_dependencies, v_manifest_digest, v_actor_id,
    v_manifest_created_at
  );

  if v_state.published_composition_id is null then
    begin
      v_global_revision_id := coalesce(
        nullif(p_request ->> 'globalRegionRevisionId', '')::uuid,
        case when v_revision.domain = 'site' then v_revision.revision_id else null end
      );
    exception when invalid_text_representation then
      raise exception 'COMPOSITION_REQUEST_INVALID' using errcode = '22023';
    end;
    v_catalog_revision := p_request ->> 'catalogRevision';
    v_catalog_digest := p_request ->> 'catalogPublicDigest';
    v_domain_publications := jsonb_build_array(jsonb_build_object(
      'domain', v_revision.domain,
      'stableId', v_revision.stable_id,
      'publicationId', v_publication_id,
      'digest', v_manifest_digest
    ));
    v_intended_delta := null;
  else
    select * into v_current
    from public.builder_site_compositions
    where site_id = p_site_id and composition_id = v_state.published_composition_id;
    if not found then
      raise exception 'COMPOSITION_POINTER_CORRUPT' using errcode = '23503';
    end if;
    v_global_revision_id := v_current.global_region_revision_id;
    v_catalog_revision := v_current.catalog_revision;
    v_catalog_digest := v_current.catalog_public_digest;
    select coalesce(jsonb_agg(value order by value ->> 'domain', value ->> 'stableId'), '[]'::jsonb)
    into v_domain_publications
    from (
      select value
      from jsonb_array_elements(v_current.domain_publications)
      where not (
        value ->> 'domain' = v_revision.domain
        and value ->> 'stableId' = v_revision.stable_id
      )
      union all
      select jsonb_build_object(
        'domain', v_revision.domain,
        'stableId', v_revision.stable_id,
        'publicationId', v_publication_id,
        'digest', v_manifest_digest
      )
    ) publication_references(value);
    v_intended_delta := jsonb_build_object(
      'kind', 'domain',
      'domain', v_revision.domain,
      'stableId', v_revision.stable_id,
      'fromPublicationId', (
        select value ->> 'publicationId'
        from jsonb_array_elements(v_current.domain_publications)
        where value ->> 'domain' = v_revision.domain
          and value ->> 'stableId' = v_revision.stable_id
        limit 1
      ),
      'toPublicationId', v_publication_id
    );
  end if;
  if v_global_revision_id is null
    or coalesce(char_length(v_catalog_revision), 0) not between 1 and 500
    or coalesce(v_catalog_digest, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'COMPOSITION_INITIALIZATION_INCOMPLETE' using errcode = '23514';
  end if;
  v_composition_digest := builder_private.builder_sha256_json(
    builder_private.builder_composition_payload_v1(
      p_site_id,
      v_composition_id,
      v_state.published_composition_id,
      v_intended_delta,
      v_global_revision_id,
      v_catalog_revision,
      v_catalog_digest,
      v_domain_publications,
      v_composition_created_at
    )
  );
  insert into public.builder_site_compositions (
    site_id, composition_id, composition_digest, base_composition_id,
    intended_delta, global_region_revision_id, catalog_revision,
    catalog_public_digest, domain_publications, created_by, created_at
  ) values (
    p_site_id, v_composition_id, v_composition_digest,
    v_state.published_composition_id, v_intended_delta, v_global_revision_id,
    v_catalog_revision, v_catalog_digest, v_domain_publications, v_actor_id,
    v_composition_created_at
  );
  v_result := jsonb_build_object(
    'schemaVersion', 1,
    'siteId', p_site_id,
    'publicationId', v_publication_id,
    'publicationDigest', v_manifest_digest,
    'candidateCompositionId', v_composition_id,
    'candidateCompositionDigest', v_composition_digest,
    'baseCompositionId', v_state.published_composition_id,
    'lockVersion', v_state.lock_version
  );
  return builder_private.builder_record_composition_idempotency_v1(
    p_site_id, v_idempotency_key, 'stage_domain', v_request_hash, v_result
  );
end;
$$;

create or replace function public.builder_publish_site_composition_v1(
  p_site_id uuid,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_actor_id uuid;
  v_idempotency_key text;
  v_request_hash text;
  v_replay jsonb;
  v_expected_lock bigint;
  v_expected_current uuid;
  v_candidate_id uuid;
  v_candidate_digest text;
  v_state public.builder_site_publication_state%rowtype;
  v_candidate public.builder_site_compositions%rowtype;
  v_next_sequence bigint;
  v_result jsonb;
begin
  begin
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_expected_lock := (p_request ->> 'expectedLockVersion')::bigint;
    v_expected_current := nullif(p_request ->> 'expectedCurrentCompositionId', '')::uuid;
    v_candidate_id := (p_request ->> 'candidateCompositionId')::uuid;
  exception when invalid_text_representation then
    raise exception 'COMPOSITION_REQUEST_INVALID' using errcode = '22023';
  end;
  v_candidate_digest := p_request ->> 'candidateCompositionDigest';
  v_idempotency_key := p_request ->> 'idempotencyKey';
  if coalesce(char_length(v_idempotency_key), 0) not between 1 and 200
    or v_expected_lock < 0
    or coalesce(v_candidate_digest, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'COMPOSITION_REQUEST_INVALID' using errcode = '22023';
  end if;
  v_request_hash := builder_private.builder_sha256_json(p_request);
  v_replay := builder_private.builder_composition_idempotency_replay_v1(
    p_site_id, v_idempotency_key, 'publish', v_request_hash
  );
  if v_replay is not null then return v_replay; end if;
  perform builder_private.builder_composition_actor_v1(
    p_site_id, v_actor_id, array['owner', 'editor']
  );
  select * into v_state
  from public.builder_site_publication_state
  where site_id = p_site_id for update;
  if not found
    or v_state.lock_version <> v_expected_lock
    or v_state.published_composition_id is distinct from v_expected_current then
    raise exception 'STALE_COMPOSITION' using errcode = '40001';
  end if;
  select * into v_candidate
  from public.builder_site_compositions
  where site_id = p_site_id and composition_id = v_candidate_id;
  if not found or v_candidate.composition_digest <> v_candidate_digest then
    raise exception 'CANDIDATE_COMPOSITION_NOT_FOUND' using errcode = '23503';
  end if;
  if v_candidate.base_composition_id is distinct from v_expected_current then
    raise exception 'UNAUTHORIZED_COMPOSITION_DELTA' using errcode = '42501';
  end if;
  v_next_sequence := v_state.published_sequence + 1;
  insert into public.builder_site_composition_publications (
    site_id, publication_sequence, composition_id, composition_digest,
    predecessor_composition_id, published_by
  ) values (
    p_site_id, v_next_sequence, v_candidate_id, v_candidate_digest,
    v_expected_current, v_actor_id
  );
  insert into public.builder_site_composition_recovery_jobs (
    site_id, publication_sequence, composition_id, composition_digest,
    predecessor_composition_id
  ) values (
    p_site_id, v_next_sequence, v_candidate_id, v_candidate_digest,
    v_expected_current
  );
  update public.builder_site_publication_state
  set published_composition_id = v_candidate_id,
      published_sequence = v_next_sequence,
      lock_version = lock_version + 1,
      updated_at = statement_timestamp()
  where site_id = p_site_id;
  v_result := jsonb_build_object(
    'schemaVersion', 1,
    'siteId', p_site_id,
    'compositionId', v_candidate_id,
    'compositionDigest', v_candidate_digest,
    'publicationSequence', v_next_sequence,
    'publishedBy', v_actor_id,
    'lockVersion', v_expected_lock + 1
  );
  return builder_private.builder_record_composition_idempotency_v1(
    p_site_id, v_idempotency_key, 'publish', v_request_hash, v_result
  );
end;
$$;

create or replace function public.builder_restore_site_composition_v1(
  p_site_id uuid,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_actor_id uuid;
  v_idempotency_key text;
  v_request_hash text;
  v_replay jsonb;
  v_expected_lock bigint;
  v_expected_current uuid;
  v_target_id uuid;
  v_state public.builder_site_publication_state%rowtype;
  v_target public.builder_site_compositions%rowtype;
  v_composition_id uuid := gen_random_uuid();
  v_created_at timestamptz := statement_timestamp();
  v_delta jsonb;
  v_digest text;
  v_result jsonb;
begin
  begin
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_expected_lock := (p_request ->> 'expectedLockVersion')::bigint;
    v_expected_current := (p_request ->> 'expectedCurrentCompositionId')::uuid;
    v_target_id := (p_request ->> 'targetCompositionId')::uuid;
  exception when invalid_text_representation then
    raise exception 'COMPOSITION_REQUEST_INVALID' using errcode = '22023';
  end;
  v_idempotency_key := p_request ->> 'idempotencyKey';
  if coalesce(char_length(v_idempotency_key), 0) not between 1 and 200
    or v_expected_lock < 0 or v_target_id = v_expected_current then
    raise exception 'COMPOSITION_REQUEST_INVALID' using errcode = '22023';
  end if;
  v_request_hash := builder_private.builder_sha256_json(p_request);
  v_replay := builder_private.builder_composition_idempotency_replay_v1(
    p_site_id, v_idempotency_key, 'restore', v_request_hash
  );
  if v_replay is not null then return v_replay; end if;
  perform builder_private.builder_composition_actor_v1(
    p_site_id, v_actor_id, array['owner', 'editor']
  );
  select * into v_state
  from public.builder_site_publication_state
  where site_id = p_site_id for update;
  if not found or v_state.lock_version <> v_expected_lock
    or v_state.published_composition_id <> v_expected_current then
    raise exception 'STALE_COMPOSITION' using errcode = '40001';
  end if;
  select * into v_target
  from public.builder_site_compositions
  where site_id = p_site_id and composition_id = v_target_id;
  if not found then
    raise exception 'RESTORE_TARGET_NOT_FOUND' using errcode = '23503';
  end if;
  v_delta := jsonb_build_object(
    'kind', 'restore',
    'fromCompositionId', v_expected_current,
    'restoredCompositionId', v_target_id
  );
  v_digest := builder_private.builder_sha256_json(
    builder_private.builder_composition_payload_v1(
      p_site_id, v_composition_id, v_expected_current, v_delta,
      v_target.global_region_revision_id, v_target.catalog_revision,
      v_target.catalog_public_digest, v_target.domain_publications, v_created_at
    )
  );
  insert into public.builder_site_compositions (
    site_id, composition_id, composition_digest, base_composition_id,
    intended_delta, global_region_revision_id, catalog_revision,
    catalog_public_digest, domain_publications, created_by, created_at
  ) values (
    p_site_id, v_composition_id, v_digest, v_expected_current,
    v_delta, v_target.global_region_revision_id, v_target.catalog_revision,
    v_target.catalog_public_digest, v_target.domain_publications, v_actor_id,
    v_created_at
  );
  v_result := jsonb_build_object(
    'schemaVersion', 1,
    'siteId', p_site_id,
    'candidateCompositionId', v_composition_id,
    'candidateCompositionDigest', v_digest,
    'baseCompositionId', v_expected_current,
    'restoredCompositionId', v_target_id,
    'lockVersion', v_state.lock_version
  );
  return builder_private.builder_record_composition_idempotency_v1(
    p_site_id, v_idempotency_key, 'restore', v_request_hash, v_result
  );
end;
$$;

create or replace function public.builder_activate_bilingual_publishing_v1(
  p_site_id uuid,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_actor_id uuid;
  v_idempotency_key text;
  v_request_hash text;
  v_replay jsonb;
  v_state public.builder_site_publication_state%rowtype;
  v_composition public.builder_site_compositions%rowtype;
  v_epoch_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  begin
    v_actor_id := (p_request ->> 'actorId')::uuid;
  exception when invalid_text_representation then
    raise exception 'ACTIVATION_REQUEST_INVALID' using errcode = '22023';
  end;
  v_idempotency_key := p_request ->> 'idempotencyKey';
  if coalesce(char_length(v_idempotency_key), 0) not between 1 and 200
    or coalesce(p_request ->> 'inventoryDigest', '') !~ '^[a-f0-9]{64}$'
    or coalesce(char_length(p_request ->> 'applicationRelease'), 0) not between 1 and 200
    or jsonb_typeof(p_request -> 'packageVersions') <> 'object'
    or jsonb_typeof(p_request -> 'migrationSet') <> 'array' then
    raise exception 'ACTIVATION_REQUEST_INVALID' using errcode = '22023';
  end if;
  v_request_hash := builder_private.builder_sha256_json(p_request);
  v_replay := builder_private.builder_composition_idempotency_replay_v1(
    p_site_id, v_idempotency_key, 'activate', v_request_hash
  );
  if v_replay is not null then return v_replay; end if;
  perform builder_private.builder_composition_actor_v1(
    p_site_id, v_actor_id, array['owner']
  );
  select * into v_state
  from public.builder_site_publication_state
  where site_id = p_site_id for update;
  if not found or v_state.published_composition_id is null
    or v_state.bilingual_active
    or v_state.lock_version <> (p_request ->> 'expectedLockVersion')::bigint then
    raise exception 'ACTIVATION_NOT_READY' using errcode = '23514';
  end if;
  select * into v_composition
  from public.builder_site_compositions
  where site_id = p_site_id and composition_id = v_state.published_composition_id;
  if v_composition.composition_digest <> p_request ->> 'expectedCompositionDigest'
    or v_composition.catalog_public_digest <> p_request ->> 'expectedCatalogPublicDigest' then
    raise exception 'ACTIVATION_INVENTORY_DRIFT' using errcode = '40001';
  end if;
  insert into public.builder_bilingual_activation_epochs (
    site_id, epoch_id, composition_id, composition_digest, inventory_digest,
    catalog_revision, catalog_public_digest, application_release,
    package_versions, migration_set, activated_by
  ) values (
    p_site_id, v_epoch_id, v_composition.composition_id,
    v_composition.composition_digest, p_request ->> 'inventoryDigest',
    v_composition.catalog_revision, v_composition.catalog_public_digest,
    p_request ->> 'applicationRelease', p_request -> 'packageVersions',
    p_request -> 'migrationSet', v_actor_id
  );
  update public.builder_site_publication_state
  set bilingual_active = true,
      activation_epoch_id = v_epoch_id,
      lock_version = lock_version + 1,
      updated_at = statement_timestamp()
  where site_id = p_site_id;
  v_result := jsonb_build_object(
    'schemaVersion', 1,
    'siteId', p_site_id,
    'epochId', v_epoch_id,
    'compositionId', v_composition.composition_id,
    'compositionDigest', v_composition.composition_digest,
    'bilingualActive', true,
    'lockVersion', v_state.lock_version + 1
  );
  return builder_private.builder_record_composition_idempotency_v1(
    p_site_id, v_idempotency_key, 'activate', v_request_hash, v_result
  );
exception
  when invalid_text_representation then
    raise exception 'ACTIVATION_REQUEST_INVALID' using errcode = '22023';
end;
$$;

create or replace function public.builder_read_published_site_composition_v1(
  p_site_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_state public.builder_site_publication_state%rowtype;
  v_composition public.builder_site_compositions%rowtype;
begin
  select * into v_state
  from public.builder_site_publication_state
  where site_id = p_site_id;
  if not found or v_state.published_composition_id is null then return null; end if;
  select * into v_composition
  from public.builder_site_compositions
  where site_id = p_site_id and composition_id = v_state.published_composition_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'schemaVersion', 1,
    'siteId', p_site_id,
    'compositionId', v_composition.composition_id,
    'compositionDigest', v_composition.composition_digest,
    'publicationSequence', v_state.published_sequence,
    'bilingualActive', v_state.bilingual_active,
    'globalRegionRevisionId', v_composition.global_region_revision_id,
    'catalogRevision', v_composition.catalog_revision,
    'catalogPublicDigest', v_composition.catalog_public_digest,
    'domainPublications', v_composition.domain_publications
  );
end;
$$;

create or replace function public.builder_claim_site_composition_recovery_job_v1(
  p_worker text,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_job public.builder_site_composition_recovery_jobs%rowtype;
  v_composition public.builder_site_compositions%rowtype;
begin
  if coalesce(char_length(btrim(p_worker)), 0) not between 1 and 200
    or p_lease_seconds not between 15 and 300 then
    raise exception 'COMPOSITION_RECOVERY_CLAIM_INVALID' using errcode = '22023';
  end if;
  select * into v_job
  from public.builder_site_composition_recovery_jobs
  where status in ('pending', 'retry') and available_at <= now()
  order by available_at, site_id, publication_sequence
  for update skip locked limit 1;
  if not found then return null; end if;
  update public.builder_site_composition_recovery_jobs
  set status = 'claimed',
      lease_owner = p_worker,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      fence_token = fence_token + 1,
      attempt_count = attempt_count + 1,
      updated_at = statement_timestamp()
  where site_id = v_job.site_id and publication_sequence = v_job.publication_sequence
  returning * into v_job;
  select * into v_composition
  from public.builder_site_compositions
  where site_id = v_job.site_id and composition_id = v_job.composition_id;
  return jsonb_build_object(
    'schemaVersion', 1,
    'siteId', v_job.site_id,
    'publicationSequence', v_job.publication_sequence,
    'compositionId', v_job.composition_id,
    'compositionDigest', v_job.composition_digest,
    'predecessorCompositionId', v_job.predecessor_composition_id,
    'attemptCount', v_job.attempt_count,
    'workerId', v_job.lease_owner,
    'fenceToken', v_job.fence_token,
    'leaseExpiresAt', v_job.lease_expires_at,
    'composition', builder_private.builder_composition_payload_v1(
      v_composition.site_id, v_composition.composition_id,
      v_composition.base_composition_id, v_composition.intended_delta,
      v_composition.global_region_revision_id, v_composition.catalog_revision,
      v_composition.catalog_public_digest, v_composition.domain_publications,
      v_composition.created_at
    ) || jsonb_build_object('compositionDigest', v_composition.composition_digest)
  );
end;
$$;

create or replace function public.builder_complete_site_composition_recovery_job_v1(
  p_site_id uuid,
  p_publication_sequence bigint,
  p_worker text,
  p_fence_token bigint,
  p_artifact jsonb,
  p_artifact_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_job public.builder_site_composition_recovery_jobs%rowtype;
  v_pointer_sequence bigint;
  v_existing_artifact_digest text;
begin
  if p_artifact_digest !~ '^[a-f0-9]{64}$'
    or p_artifact ->> 'artifactDigest' is distinct from p_artifact_digest
    or p_artifact_digest <> builder_private.builder_sha256_json(p_artifact - 'artifactDigest') then
    raise exception 'COMPOSITION_RECOVERY_ARTIFACT_INVALID' using errcode = '22023';
  end if;
  select * into v_job
  from public.builder_site_composition_recovery_jobs
  where site_id = p_site_id
    and publication_sequence = p_publication_sequence
    and status = 'claimed'
    and lease_owner = p_worker
    and fence_token = p_fence_token
    and lease_expires_at > now()
  for update;
  if not found then return jsonb_build_object('status', 'stale_lease'); end if;
  if p_artifact ->> 'siteId' <> v_job.site_id::text
    or (p_artifact ->> 'publicationSequence')::bigint <> v_job.publication_sequence
    or p_artifact ->> 'compositionId' <> v_job.composition_id::text
    or p_artifact ->> 'compositionDigest' <> v_job.composition_digest then
    raise exception 'COMPOSITION_RECOVERY_ARTIFACT_MISMATCH' using errcode = '22023';
  end if;
  insert into public.builder_site_composition_recovery_artifacts (
    site_id, composition_id, composition_digest, predecessor_composition_id,
    publication_sequence, artifact, artifact_digest, expires_at
  ) values (
    v_job.site_id, v_job.composition_id, v_job.composition_digest,
    v_job.predecessor_composition_id, v_job.publication_sequence,
    p_artifact, p_artifact_digest, statement_timestamp() + interval '90 days'
  ) on conflict (site_id, publication_sequence) do nothing;
  select artifact_digest into v_existing_artifact_digest
  from public.builder_site_composition_recovery_artifacts
  where site_id = v_job.site_id
    and publication_sequence = v_job.publication_sequence;
  if v_existing_artifact_digest is distinct from p_artifact_digest then
    raise exception 'COMPOSITION_RECOVERY_ARTIFACT_CONFLICT' using errcode = '23505';
  end if;
  select publication_sequence into v_pointer_sequence
  from public.builder_site_composition_recovery_pointer
  where site_id = p_site_id for update;
  if not found or v_job.publication_sequence > v_pointer_sequence then
    insert into public.builder_site_composition_recovery_pointer (
      site_id, publication_sequence, composition_id, composition_digest,
      artifact_digest, updated_at
    ) values (
      v_job.site_id, v_job.publication_sequence, v_job.composition_id,
      v_job.composition_digest, p_artifact_digest, statement_timestamp()
    ) on conflict (site_id) do update set
      publication_sequence = excluded.publication_sequence,
      composition_id = excluded.composition_id,
      composition_digest = excluded.composition_digest,
      artifact_digest = excluded.artifact_digest,
      updated_at = excluded.updated_at
    where excluded.publication_sequence > public.builder_site_composition_recovery_pointer.publication_sequence;
  end if;
  update public.builder_site_composition_recovery_jobs
  set status = 'completed', completed_at = statement_timestamp(),
      lease_owner = null, lease_expires_at = null,
      updated_at = statement_timestamp()
  where site_id = v_job.site_id and publication_sequence = v_job.publication_sequence;
  return jsonb_build_object(
    'status', 'completed',
    'publicationSequence', v_job.publication_sequence,
    'pointerAdvanced', coalesce(v_pointer_sequence, 0) < v_job.publication_sequence
  );
exception when invalid_text_representation then
  raise exception 'COMPOSITION_RECOVERY_ARTIFACT_INVALID' using errcode = '22023';
end;
$$;

create or replace function public.builder_fail_site_composition_recovery_job_v1(
  p_site_id uuid,
  p_publication_sequence bigint,
  p_worker text,
  p_fence_token bigint,
  p_error_code text,
  p_retry_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.builder_site_composition_recovery_jobs%rowtype;
  v_status text;
begin
  if coalesce(p_error_code, '') !~ '^[a-z0-9][a-z0-9_.-]{0,127}$'
    or p_retry_at < statement_timestamp() - interval '1 minute'
    or p_retry_at > statement_timestamp() + interval '24 hours' then
    raise exception 'COMPOSITION_RECOVERY_FAILURE_INVALID' using errcode = '22023';
  end if;
  select * into v_job
  from public.builder_site_composition_recovery_jobs
  where site_id = p_site_id and publication_sequence = p_publication_sequence
    and status = 'claimed' and lease_owner = p_worker
    and fence_token = p_fence_token and lease_expires_at > now()
  for update;
  if not found then return jsonb_build_object('status', 'stale_lease'); end if;
  v_status := case when v_job.attempt_count >= 5 then 'dead_letter' else 'retry' end;
  update public.builder_site_composition_recovery_jobs
  set status = v_status, available_at = p_retry_at, last_error = p_error_code,
      lease_owner = null, lease_expires_at = null, updated_at = statement_timestamp()
  where site_id = p_site_id and publication_sequence = p_publication_sequence;
  return jsonb_build_object('status', v_status, 'attemptCount', v_job.attempt_count);
end;
$$;

alter table public.builder_localized_domain_revisions enable row level security;
alter table public.builder_domain_publication_manifests enable row level security;
alter table public.builder_site_compositions enable row level security;
alter table public.builder_site_publication_state enable row level security;
alter table public.builder_site_composition_publications enable row level security;
alter table public.builder_composition_idempotency_results enable row level security;
alter table public.builder_bilingual_activation_epochs enable row level security;
alter table public.builder_site_composition_recovery_artifacts enable row level security;
alter table public.builder_site_composition_recovery_pointer enable row level security;
alter table public.builder_site_composition_recovery_jobs enable row level security;

create policy builder_localized_domain_revisions_read
on public.builder_localized_domain_revisions for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor', 'contributor', 'viewer']));

create policy builder_domain_publication_manifests_read
on public.builder_domain_publication_manifests for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor', 'contributor', 'viewer']));

create policy builder_site_compositions_read
on public.builder_site_compositions for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor', 'contributor', 'viewer']));

create policy builder_site_composition_publications_read
on public.builder_site_composition_publications for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor', 'contributor', 'viewer']));

create policy builder_bilingual_activation_epochs_read
on public.builder_bilingual_activation_epochs for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor']));

revoke all on public.builder_localized_domain_revisions,
  public.builder_domain_publication_manifests,
  public.builder_site_compositions,
  public.builder_site_publication_state,
  public.builder_site_composition_publications,
  public.builder_composition_idempotency_results,
  public.builder_bilingual_activation_epochs,
  public.builder_site_composition_recovery_artifacts,
  public.builder_site_composition_recovery_pointer,
  public.builder_site_composition_recovery_jobs
from public, anon, authenticated;

grant select on public.builder_localized_domain_revisions,
  public.builder_domain_publication_manifests,
  public.builder_site_compositions,
  public.builder_site_composition_publications,
  public.builder_bilingual_activation_epochs
to authenticated;

grant all on public.builder_localized_domain_revisions,
  public.builder_domain_publication_manifests,
  public.builder_site_compositions,
  public.builder_site_publication_state,
  public.builder_site_composition_publications,
  public.builder_composition_idempotency_results,
  public.builder_bilingual_activation_epochs,
  public.builder_site_composition_recovery_artifacts,
  public.builder_site_composition_recovery_pointer,
  public.builder_site_composition_recovery_jobs
to service_role;

revoke all on function builder_private.builder_canonical_json(jsonb) from public, anon, authenticated;
revoke all on function builder_private.builder_sha256_json(jsonb) from public, anon, authenticated;
revoke all on function builder_private.builder_validate_localized_text_v1(jsonb) from public, anon, authenticated;
revoke all on function builder_private.builder_validate_localized_snapshot_v1(jsonb) from public, anon, authenticated;
revoke all on function builder_private.builder_prepare_localized_revision_v1() from public, anon, authenticated;
revoke all on function builder_private.builder_validate_domain_manifest_v1() from public, anon, authenticated;
revoke all on function builder_private.builder_composition_payload_v1(uuid, uuid, uuid, jsonb, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function builder_private.builder_validate_site_composition_v1() from public, anon, authenticated;
revoke all on function builder_private.builder_composition_actor_v1(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function builder_private.builder_composition_idempotency_replay_v1(uuid, text, text, text) from public, anon, authenticated;
revoke all on function builder_private.builder_record_composition_idempotency_v1(uuid, text, text, text, jsonb) from public, anon, authenticated;

revoke all on function public.builder_stage_domain_composition_v1(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.builder_publish_site_composition_v1(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.builder_restore_site_composition_v1(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.builder_activate_bilingual_publishing_v1(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.builder_read_published_site_composition_v1(uuid) from public, anon, authenticated;
revoke all on function public.builder_claim_site_composition_recovery_job_v1(text, integer) from public, anon, authenticated;
revoke all on function public.builder_complete_site_composition_recovery_job_v1(uuid, bigint, text, bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.builder_fail_site_composition_recovery_job_v1(uuid, bigint, text, bigint, text, timestamptz) from public, anon, authenticated;

grant execute on function public.builder_stage_domain_composition_v1(uuid, jsonb) to service_role;
grant execute on function public.builder_publish_site_composition_v1(uuid, jsonb) to service_role;
grant execute on function public.builder_restore_site_composition_v1(uuid, jsonb) to service_role;
grant execute on function public.builder_activate_bilingual_publishing_v1(uuid, jsonb) to service_role;
grant execute on function public.builder_read_published_site_composition_v1(uuid) to service_role;
grant execute on function public.builder_claim_site_composition_recovery_job_v1(text, integer) to service_role;
grant execute on function public.builder_complete_site_composition_recovery_job_v1(uuid, bigint, text, bigint, jsonb, text) to service_role;
grant execute on function public.builder_fail_site_composition_recovery_job_v1(uuid, bigint, text, bigint, text, timestamptz) to service_role;

alter table public.builder_history_events_v1
  drop constraint builder_history_events_v1_source_check,
  add constraint builder_history_events_v1_source_check
    check (source in ('page', 'media', 'post', 'form', 'alert', 'translation')),
  drop constraint builder_history_events_v1_category_check,
  add constraint builder_history_events_v1_category_check
    check (category in (
      'text', 'media', 'links', 'sections', 'posts', 'forms', 'publishing', 'alerts',
      'translations', 'translation_approval', 'language_neutral_exemption'
    )),
  add column localization_revision_id uuid,
  add column localization_field_id text
    check (localization_field_id is null or char_length(localization_field_id) between 1 and 500),
  add foreign key (site_id, localization_revision_id)
    references public.builder_localized_domain_revisions(site_id, revision_id) on delete restrict;

alter table public.builder_audit_log
  drop constraint builder_audit_log_action_check,
  add constraint builder_audit_log_action_check check (action in (
    'draft.saved', 'version.published', 'version.rolled_back', 'rollback.undone', 'media.uploaded',
    'alert.created', 'alert.draft_edited', 'alert.reordered', 'alert.enabled_changed',
    'alert.schedule_changed', 'alert.archived', 'alert.published',
    'translation.draft_edited', 'translation.review_requested', 'translation.approved',
    'translation.invalidated', 'translation.exemption_requested', 'translation.exemption_approved',
    'translation.deleted', 'translation.restored', 'composition.staged', 'composition.published',
    'composition.restored', 'bilingual.activated'
  )),
  drop constraint builder_audit_log_kind_check,
  add constraint builder_audit_log_kind_check
    check (kind in ('text', 'richText', 'image', 'link', 'sections', 'icon', 'alert', 'translation', 'composition'));
