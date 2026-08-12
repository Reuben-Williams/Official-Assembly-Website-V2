create table public.builder_editor_login_completion_proofs (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  session_generation integer not null check (session_generation > 0),
  proof_digest text not null check (proof_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  primary key (site_id, id),
  unique (proof_digest),
  foreign key (site_id, user_id)
    references public.builder_site_members(site_id, user_id)
    on delete cascade,
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index builder_editor_login_completion_proofs_pending_idx
  on public.builder_editor_login_completion_proofs (site_id, user_id, expires_at)
  where consumed_at is null;

alter table public.builder_editor_login_completion_proofs enable row level security;

revoke all on table public.builder_editor_login_completion_proofs
from public, anon, authenticated;
grant select, insert, update, delete on table public.builder_editor_login_completion_proofs
to service_role;

create function public.builder_issue_editor_login_completion_proof_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_user_id uuid;
  v_generation integer;
  v_digest text;
  v_expires_at timestamptz;
begin
  begin
    if jsonb_typeof(p_request) <> 'object'
      or p_request ->> 'version' <> '1'
      or not (p_request ?& array[
        'version', 'siteKey', 'userId', 'sessionGeneration', 'proofDigest', 'expiresAt'
      ])
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(p_request) key
        where key <> all(array[
          'version', 'siteKey', 'userId', 'sessionGeneration', 'proofDigest', 'expiresAt'
        ])
      )
    then raise exception 'invalid editor login completion proof' using errcode = '22023'; end if;
    v_user_id := (p_request ->> 'userId')::uuid;
    v_generation := (p_request ->> 'sessionGeneration')::integer;
    v_digest := p_request ->> 'proofDigest';
    v_expires_at := (p_request ->> 'expiresAt')::timestamptz;
  exception when others then
    raise exception 'invalid editor login completion proof' using errcode = '22023';
  end;

  if (p_request ->> 'siteKey') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or v_generation < 1
    or v_digest !~ '^[a-f0-9]{64}$'
    or v_expires_at <= statement_timestamp()
    or v_expires_at > statement_timestamp() + interval '5 minutes'
  then
    raise exception 'invalid editor login completion proof' using errcode = '22023';
  end if;

  select site.id into v_site_id
  from public.builder_sites site
  join public.builder_site_members member on member.site_id = site.id
  where site.site_key = p_request ->> 'siteKey'
    and member.user_id = v_user_id
    and member.session_generation = v_generation;
  if v_site_id is null then
    raise exception 'editor login completion proof not authorized' using errcode = '42501';
  end if;

  delete from public.builder_editor_login_completion_proofs proof
  where proof.site_id = v_site_id
    and proof.expires_at <= statement_timestamp();

  insert into public.builder_editor_login_completion_proofs (
    site_id, user_id, session_generation, proof_digest, expires_at
  ) values (
    v_site_id, v_user_id, v_generation, v_digest, v_expires_at
  );

  return jsonb_build_object('version', 1, 'status', 'issued');
end;
$$;

create function public.builder_consume_editor_login_completion_proof_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_user_id uuid;
  v_generation integer;
  v_digest text;
  v_proof_id uuid;
begin
  begin
    if jsonb_typeof(p_request) <> 'object'
      or p_request ->> 'version' <> '1'
      or not (p_request ?& array['version', 'siteKey', 'userId', 'sessionGeneration', 'proofDigest'])
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(p_request) key
        where key <> all(array['version', 'siteKey', 'userId', 'sessionGeneration', 'proofDigest'])
      )
    then raise exception 'invalid editor login completion proof' using errcode = '22023'; end if;
    v_user_id := (p_request ->> 'userId')::uuid;
    v_generation := (p_request ->> 'sessionGeneration')::integer;
    v_digest := p_request ->> 'proofDigest';
  exception when others then
    raise exception 'invalid editor login completion proof' using errcode = '22023';
  end;

  if (p_request ->> 'siteKey') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or v_generation < 1
    or v_digest !~ '^[a-f0-9]{64}$'
  then
    raise exception 'invalid editor login completion proof' using errcode = '22023';
  end if;

  select site.id into v_site_id
  from public.builder_sites site
  join public.builder_site_members member on member.site_id = site.id
  where site.site_key = p_request ->> 'siteKey'
    and member.user_id = v_user_id
    and member.session_generation = v_generation;
  if v_site_id is null then
    return jsonb_build_object('version', 1, 'status', 'rejected');
  end if;

  select proof.id into v_proof_id
  from public.builder_editor_login_completion_proofs proof
  where proof.site_id = v_site_id
    and proof.user_id = v_user_id
    and proof.session_generation = v_generation
    and proof.proof_digest = v_digest
    and proof.consumed_at is null
    and proof.expires_at > statement_timestamp()
  for update skip locked;

  if v_proof_id is null then
    return jsonb_build_object('version', 1, 'status', 'rejected');
  end if;

  update public.builder_editor_login_completion_proofs proof
  set consumed_at = statement_timestamp()
  where proof.site_id = v_site_id
    and proof.id = v_proof_id
    and proof.consumed_at is null
    and proof.expires_at > statement_timestamp();
  if not found then
    return jsonb_build_object('version', 1, 'status', 'rejected');
  end if;

  return jsonb_build_object('version', 1, 'status', 'consumed');
end;
$$;

revoke all on function public.builder_issue_editor_login_completion_proof_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_consume_editor_login_completion_proof_v1(jsonb)
from public, anon, authenticated;
grant execute on function public.builder_issue_editor_login_completion_proof_v1(jsonb)
to service_role;
grant execute on function public.builder_consume_editor_login_completion_proof_v1(jsonb)
to service_role;
