create function builder_private.validate_managed_form_configuration(p_configuration jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_completion jsonb;
  v_qualification jsonb;
begin
  if jsonb_typeof(p_configuration) <> 'object'
    or octet_length(p_configuration::text) > 65536
    or not (p_configuration ?& array[
      'templateId', 'templateVersion', 'displayName', 'fields', 'qualification',
      'completion', 'consentPolicyVersion'
    ])
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_configuration) key
      where key <> all(array[
        'templateId', 'templateVersion', 'displayName', 'fields', 'qualification',
        'completion', 'consentPolicyVersion'
      ])
    )
    or (p_configuration ->> 'templateId') !~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
    or (p_configuration ->> 'templateVersion') !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
    or char_length(btrim(p_configuration ->> 'displayName')) not between 1 and 80
    or (p_configuration ->> 'consentPolicyVersion') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
    or jsonb_typeof(p_configuration -> 'fields') <> 'array'
    or jsonb_array_length(p_configuration -> 'fields') not between 1 and 32
  then
    return false;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_configuration -> 'fields') field(value)
    where jsonb_typeof(field.value) <> 'object'
      or not (field.value ?& array['key', 'label', 'helpText', 'placeholder', 'visible', 'required'])
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(field.value) field_key
        where field_key <> all(array['key', 'label', 'helpText', 'placeholder', 'visible', 'required', 'optionIds'])
      )
      or (field.value ->> 'key') !~ '^[a-z][A-Za-z0-9]{0,63}$'
      or char_length(btrim(field.value ->> 'label')) not between 1 and 80
      or char_length(field.value ->> 'helpText') > 160
      or char_length(field.value ->> 'placeholder') > 120
      or jsonb_typeof(field.value -> 'visible') <> 'boolean'
      or jsonb_typeof(field.value -> 'required') <> 'boolean'
      or (
        field.value ? 'optionIds'
        and (
          jsonb_typeof(field.value -> 'optionIds') <> 'array'
          or jsonb_array_length(field.value -> 'optionIds') not between 1 and 50
          or exists (
            select 1 from pg_catalog.jsonb_array_elements_text(field.value -> 'optionIds') option_id
            where option_id !~ '^[a-z][a-z0-9-]{0,63}$'
          )
        )
      )
  ) then
    return false;
  end if;

  if (
    select count(*) from (
      select field.value ->> 'key'
      from pg_catalog.jsonb_array_elements(p_configuration -> 'fields') field(value)
      group by field.value ->> 'key'
      having count(*) > 1
    ) duplicate_keys
  ) > 0 then
    return false;
  end if;

  v_qualification := p_configuration -> 'qualification';
  if jsonb_typeof(v_qualification) <> 'object'
    or not (v_qualification ?& array['enabled', 'allowedZipCodes'])
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(v_qualification) key
      where key <> all(array['enabled', 'allowedZipCodes'])
    )
    or jsonb_typeof(v_qualification -> 'enabled') <> 'boolean'
    or jsonb_typeof(v_qualification -> 'allowedZipCodes') <> 'array'
    or jsonb_array_length(v_qualification -> 'allowedZipCodes') > 500
    or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(v_qualification -> 'allowedZipCodes') zip
      where zip !~ '^[0-9]{5}$'
    )
  then
    return false;
  end if;

  v_completion := p_configuration -> 'completion';
  if jsonb_typeof(v_completion) <> 'object'
    or (v_completion ->> 'mode') not in ('inline_success', 'same_site_redirect')
    or char_length(btrim(v_completion ->> 'successCopy')) not between 1 and 240
    or (v_completion ? 'outOfAreaSuccessCopy' and char_length(btrim(v_completion ->> 'outOfAreaSuccessCopy')) not between 1 and 240)
  then
    return false;
  end if;

  if v_completion ->> 'mode' = 'inline_success' then
    if exists (
      select 1 from pg_catalog.jsonb_object_keys(v_completion) key
      where key <> all(array['mode', 'successCopy', 'outOfAreaSuccessCopy'])
    ) then return false; end if;
  else
    if not (v_completion ? 'defaultRedirectPath')
      or (v_completion ->> 'defaultRedirectPath') !~ '^/(?!/)[^?]*$'
      or (v_completion ? 'outOfAreaRedirectPath' and (v_completion ->> 'outOfAreaRedirectPath') !~ '^/(?!/)[^?]*$')
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_completion) key
        where key <> all(array[
          'mode', 'successCopy', 'outOfAreaSuccessCopy',
          'defaultRedirectPath', 'outOfAreaRedirectPath'
        ])
      )
    then return false; end if;
  end if;

  return true;
end;
$$;

revoke all on function builder_private.validate_managed_form_configuration(jsonb)
from public, anon, authenticated, service_role;

create table public.builder_forms (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  form_key text not null check (form_key ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' and char_length(form_key) <= 80),
  template_id text not null check (template_id ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$' and char_length(template_id) <= 160),
  template_version text not null check (template_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  activation_state text not null default 'active' check (activation_state in ('active', 'paused', 'archived')),
  draft_revision_id uuid,
  published_revision_id uuid,
  record_version integer not null default 1 check (record_version > 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, form_key),
  unique (site_id, id, draft_revision_id),
  unique (site_id, id, published_revision_id),
  foreign key (site_id, created_by) references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, updated_by) references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_form_revisions (
  site_id uuid not null,
  form_id uuid not null,
  id uuid not null default gen_random_uuid(),
  revision_number integer not null check (revision_number > 0),
  template_id text not null check (template_id ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$' and char_length(template_id) <= 160),
  template_version text not null check (template_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  contract_digest text not null check (contract_digest ~ '^[a-f0-9]{64}$'),
  schema_version integer not null default 1 check (schema_version > 0),
  configuration jsonb not null check (builder_private.validate_managed_form_configuration(configuration)),
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, form_id, id),
  unique (site_id, id),
  unique (site_id, form_id, revision_number),
  foreign key (site_id, form_id) references public.builder_forms(site_id, id) on delete restrict,
  foreign key (site_id, created_by) references public.builder_site_members(site_id, user_id) on delete restrict
);

alter table public.builder_forms
  add constraint builder_forms_draft_revision_fk
  foreign key (site_id, id, draft_revision_id)
  references public.builder_form_revisions(site_id, form_id, id)
  deferrable initially deferred;

alter table public.builder_forms
  add constraint builder_forms_published_revision_fk
  foreign key (site_id, id, published_revision_id)
  references public.builder_form_revisions(site_id, form_id, id)
  deferrable initially deferred;

create table public.builder_form_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  form_id uuid not null,
  command_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'),
  command_digest text not null check (command_digest ~ '^[a-f0-9]{64}$'),
  event_kind text not null check (event_kind in (
    'created', 'draft_saved', 'published', 'paused', 'resumed',
    'restored', 'archived', 'unarchived'
  )),
  actor_id uuid,
  prior_record_version integer check (prior_record_version is null or prior_record_version > 0),
  new_record_version integer not null check (new_record_version > 0),
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  safe_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(safe_metadata) = 'object' and octet_length(safe_metadata::text) <= 8192
  ),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, command_id),
  unique (site_id, idempotency_key),
  foreign key (site_id, form_id) references public.builder_forms(site_id, id) on delete restrict,
  foreign key (site_id, actor_id) references public.builder_site_members(site_id, user_id) on delete restrict
);

alter table public.builder_form_submissions
  add column form_identity_id uuid,
  add column form_revision_id uuid,
  add column template_id text,
  add column template_version text,
  add column contract_digest text,
  add column ingestion_contract_version integer not null default 1 check (ingestion_contract_version in (1, 2)),
  add column qualification_result text check (
    qualification_result is null or qualification_result in ('in_area', 'out_of_area', 'not_configured')
  ),
  add column source_page text check (
    source_page is null or (source_page ~ '^/(?!/)[^?]*$' and char_length(source_page) <= 2048)
  ),
  add column security_receipt_id uuid;

alter table public.builder_form_submissions
  add constraint builder_form_submissions_managed_form_fk
  foreign key (site_id, form_identity_id) references public.builder_forms(site_id, id) on delete restrict,
  add constraint builder_form_submissions_revision_fk
  foreign key (site_id, form_identity_id, form_revision_id)
  references public.builder_form_revisions(site_id, form_id, id) on delete restrict,
  add constraint builder_form_submissions_v2_identity_check check (
    (ingestion_contract_version = 1 and form_identity_id is null and form_revision_id is null)
    or (
      ingestion_contract_version = 2
      and form_identity_id is not null
      and form_revision_id is not null
      and template_id is not null
      and template_version is not null
      and contract_digest ~ '^[a-f0-9]{64}$'
      and qualification_result is not null
      and source_page is not null
      and security_receipt_id is not null
    )
  );

create index builder_forms_site_state_idx
on public.builder_forms (site_id, activation_state, updated_at desc, id);
create index builder_form_revisions_history_idx
on public.builder_form_revisions (site_id, form_id, revision_number desc);
create index builder_form_events_history_idx
on public.builder_form_events (site_id, form_id, created_at desc, id);
create index builder_form_submissions_revision_idx
on public.builder_form_submissions (site_id, form_identity_id, form_revision_id, received_at desc)
where ingestion_contract_version = 2;

create trigger builder_form_revisions_append_only
before update or delete on public.builder_form_revisions
for each row execute function builder_private.reject_append_only_change();

create trigger builder_form_events_append_only
before update or delete on public.builder_form_events
for each row execute function builder_private.reject_append_only_change();

create function builder_private.member_has_website_capability(
  p_site_id uuid,
  p_member_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if p_capability not in (
    'forms.read', 'forms.editDraft', 'forms.publish', 'forms.archive', 'forms.configureRouting',
    'submissions.read', 'submissions.review', 'submissions.export',
    'submissions.manageConsent', 'submissions.deleteRequest', 'submissions.manageRetention'
  ) then return false; end if;

  select member.role into v_role
  from public.builder_site_members member
  where member.site_id = p_site_id and member.user_id = p_member_id;

  if v_role = 'owner' then return true; end if;
  if v_role = 'editor' then
    return p_capability in (
      'forms.read', 'forms.editDraft', 'forms.publish', 'submissions.read', 'submissions.review'
    );
  end if;
  if v_role = 'contributor' then
    return p_capability in ('forms.read', 'forms.editDraft');
  end if;
  return false;
end;
$$;

create function builder_private.current_member_has_website_capability(
  p_site_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select builder_private.member_has_website_capability(p_site_id, (select auth.uid()), p_capability);
$$;

revoke all on function builder_private.member_has_website_capability(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function builder_private.current_member_has_website_capability(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function builder_private.current_member_has_website_capability(uuid, text)
to authenticated;

alter table public.builder_forms enable row level security;
alter table public.builder_form_revisions enable row level security;
alter table public.builder_form_events enable row level security;

create policy builder_forms_capability_read on public.builder_forms
for select to authenticated
using (builder_private.current_member_has_website_capability(site_id, 'forms.read'));

create policy builder_form_revisions_capability_read on public.builder_form_revisions
for select to authenticated
using (builder_private.current_member_has_website_capability(site_id, 'forms.read'));

create policy builder_form_events_capability_read on public.builder_form_events
for select to authenticated
using (builder_private.current_member_has_website_capability(site_id, 'forms.read'));

revoke all on public.builder_forms, public.builder_form_revisions, public.builder_form_events
from public, anon, authenticated, service_role;
grant select on public.builder_forms, public.builder_form_revisions, public.builder_form_events
to authenticated, service_role;

create function builder_private.form_command_digest(p_request jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_request::text, 'UTF8'), 'sha256'), 'hex');
$$;

create function builder_private.append_form_event(
  p_site_id uuid,
  p_form_id uuid,
  p_request jsonb,
  p_event_kind text,
  p_prior_version integer,
  p_new_version integer,
  p_actor_id uuid,
  p_reason_code text,
  p_safe_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.builder_form_events (
    site_id, form_id, command_id, idempotency_key, command_digest, event_kind,
    actor_id, prior_record_version, new_record_version, reason_code, safe_metadata
  ) values (
    p_site_id, p_form_id, (p_request ->> 'commandId')::uuid,
    p_request ->> 'idempotencyKey', builder_private.form_command_digest(p_request),
    p_event_kind, p_actor_id, p_prior_version, p_new_version, p_reason_code,
    coalesce(p_safe_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

create function public.builder_reconcile_core_website_forms_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_form jsonb;
  v_form_id uuid;
  v_revision_id uuid;
  v_created integer := 0;
  v_preserved integer := 0;
  v_managed jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or octet_length(p_request::text) > 262144
    or not (p_request ?& array['version', 'siteId', 'forms'])
    or (p_request ->> 'version') <> '1'
    or jsonb_typeof(p_request -> 'forms') <> 'array'
    or jsonb_array_length(p_request -> 'forms') > 50
  then raise exception 'invalid forms reconciliation request' using errcode = '22023'; end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_actor_id := case when p_request ? 'actorId' then (p_request ->> 'actorId')::uuid else null end;
  exception when others then
    raise exception 'invalid forms reconciliation request' using errcode = '22023';
  end;

  if not exists (select 1 from public.builder_sites where id = v_site_id)
    or (v_actor_id is not null and not exists (
      select 1 from public.builder_site_members where site_id = v_site_id and user_id = v_actor_id
    ))
  then raise exception 'forms reconciliation references unknown site records' using errcode = '22023'; end if;

  for v_form in select value from pg_catalog.jsonb_array_elements(p_request -> 'forms') loop
    if jsonb_typeof(v_form) <> 'object'
      or not (v_form ?& array['formKey', 'templateId', 'templateVersion', 'contractDigest', 'configuration'])
      or (v_form ->> 'formKey') !~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'
      or (v_form ->> 'templateId') !~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
      or (v_form ->> 'templateVersion') !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
      or (v_form ->> 'contractDigest') !~ '^[a-f0-9]{64}$'
      or not builder_private.validate_managed_form_configuration(v_form -> 'configuration')
      or (v_form #>> '{configuration,templateId}') <> (v_form ->> 'templateId')
      or (v_form #>> '{configuration,templateVersion}') <> (v_form ->> 'templateVersion')
    then raise exception 'invalid managed form declaration' using errcode = '22023'; end if;

    select form_row.id into v_form_id
    from public.builder_forms form_row
    where form_row.site_id = v_site_id and form_row.form_key = v_form ->> 'formKey'
    for update;

    if found then
      if not exists (
        select 1 from public.builder_forms form_row
        where form_row.site_id = v_site_id and form_row.id = v_form_id
          and form_row.template_id = v_form ->> 'templateId'
          and form_row.template_version = v_form ->> 'templateVersion'
      ) then
        raise exception 'managed form declaration conflicts with existing identity' using errcode = '22023';
      end if;
      v_preserved := v_preserved + 1;
    else
      v_form_id := gen_random_uuid();
      v_revision_id := gen_random_uuid();
      insert into public.builder_forms (
        site_id, id, form_key, template_id, template_version, activation_state,
        draft_revision_id, record_version, created_by, updated_by
      ) values (
        v_site_id, v_form_id, v_form ->> 'formKey', v_form ->> 'templateId',
        v_form ->> 'templateVersion', 'active', v_revision_id, 1, v_actor_id, v_actor_id
      );
      insert into public.builder_form_revisions (
        site_id, form_id, id, revision_number, template_id, template_version,
        contract_digest, schema_version, configuration, created_by
      ) values (
        v_site_id, v_form_id, v_revision_id, 1, v_form ->> 'templateId',
        v_form ->> 'templateVersion', v_form ->> 'contractDigest',
        coalesce((v_form ->> 'schemaVersion')::integer, 1), v_form -> 'configuration', v_actor_id
      );
      perform builder_private.append_form_event(
        v_site_id, v_form_id,
        jsonb_build_object(
          'commandId', gen_random_uuid(),
          'idempotencyKey', 'forms.reconcile:' || (v_form ->> 'formKey')
        ),
        'created', null, 1, v_actor_id, 'PROVISIONED',
        jsonb_build_object('revisionNumber', 1)
      );
      v_created := v_created + 1;
    end if;

    v_managed := v_managed || jsonb_build_object(
      v_form ->> 'formKey',
      jsonb_build_object(
        'formId', v_form_id,
        'templateId', v_form ->> 'templateId',
        'templateVersion', v_form ->> 'templateVersion'
      )
    );
  end loop;

  update public.builder_module_configurations configuration
  set configuration = jsonb_set(
        configuration.configuration,
        '{forms}',
        jsonb_set(
          coalesce(configuration.configuration -> 'forms', '{}'::jsonb),
          '{_managed}',
          coalesce(configuration.configuration #> '{forms,_managed}', '{}'::jsonb) || v_managed,
          true
        ),
        true
      ),
      updated_at = clock_timestamp()
  where configuration.site_id = v_site_id and configuration.module_id = 'core.website';

  if not found then
    insert into public.builder_module_configurations (
      site_id, module_id, config_version, setup_status, entitlement_state,
      disabled_by_default, configuration
    ) values (
      v_site_id, 'core.website', 2, 'configured', 'provisioning', true,
      jsonb_build_object('forms', jsonb_build_object('_managed', v_managed))
    );
  end if;

  return jsonb_build_object(
    'version', 1, 'siteId', v_site_id, 'createdCount', v_created,
    'preservedCount', v_preserved, 'formCount', jsonb_array_length(p_request -> 'forms')
  );
end;
$$;

create function public.builder_apply_form_command_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_command_id uuid;
  v_form_id uuid;
  v_source_revision_id uuid;
  v_expected_version integer;
  v_action text;
  v_required_capability text;
  v_digest text;
  v_existing_event public.builder_form_events%rowtype;
  v_form public.builder_forms%rowtype;
  v_revision public.builder_form_revisions%rowtype;
  v_revision_id uuid;
  v_revision_number integer;
  v_new_version integer;
  v_reason_code text;
  v_result jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or octet_length(p_request::text) > 131072
    or not (p_request ?& array[
      'version', 'commandId', 'idempotencyKey', 'siteId', 'actorId', 'action', 'expectedVersion'
    ])
    or (p_request ->> 'version') <> '1'
    or (p_request ->> 'idempotencyKey') !~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'
  then raise exception 'invalid form command' using errcode = '22023'; end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_command_id := (p_request ->> 'commandId')::uuid;
    v_expected_version := (p_request ->> 'expectedVersion')::integer;
    v_action := p_request ->> 'action';
    v_form_id := case when p_request ? 'formId' then (p_request ->> 'formId')::uuid else null end;
    v_source_revision_id := case when p_request ? 'sourceRevisionId' then (p_request ->> 'sourceRevisionId')::uuid else null end;
  exception when others then
    raise exception 'invalid form command' using errcode = '22023';
  end;

  if v_action not in ('create', 'save', 'publish', 'pause', 'resume', 'restore', 'archive', 'unarchive')
    or v_expected_version < 0
  then raise exception 'invalid form command' using errcode = '22023'; end if;

  v_required_capability := case
    when v_action in ('create', 'save', 'restore') then 'forms.editDraft'
    when v_action in ('publish', 'pause', 'resume') then 'forms.publish'
    else 'forms.archive'
  end;
  if not builder_private.member_has_website_capability(v_site_id, v_actor_id, v_required_capability) then
    raise exception 'form command is not authorized' using errcode = '42501';
  end if;

  v_digest := builder_private.form_command_digest(p_request);
  select event.* into v_existing_event
  from public.builder_form_events event
  where event.site_id = v_site_id
    and (event.command_id = v_command_id or event.idempotency_key = p_request ->> 'idempotencyKey')
  order by event.id
  limit 1;
  if found then
    if v_existing_event.command_id <> v_command_id
      or v_existing_event.idempotency_key <> p_request ->> 'idempotencyKey'
      or v_existing_event.command_digest <> v_digest
    then raise exception 'form command idempotency conflict' using errcode = 'P2F09'; end if;
    return jsonb_build_object(
      'version', 1, 'status', 'replayed', 'formId', v_existing_event.form_id,
      'recordVersion', v_existing_event.new_record_version
    );
  end if;

  if v_action = 'create' then
    if v_expected_version <> 0
      or not (p_request ?& array['formKey', 'templateId', 'templateVersion', 'contractDigest', 'configuration'])
      or (p_request ->> 'formKey') !~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'
      or (p_request ->> 'templateId') !~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
      or (p_request ->> 'templateVersion') !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
      or (p_request ->> 'contractDigest') !~ '^[a-f0-9]{64}$'
      or not builder_private.validate_managed_form_configuration(p_request -> 'configuration')
      or (p_request #>> '{configuration,templateId}') <> (p_request ->> 'templateId')
      or (p_request #>> '{configuration,templateVersion}') <> (p_request ->> 'templateVersion')
    then raise exception 'invalid create form command' using errcode = '22023'; end if;

    v_form_id := coalesce(v_form_id, gen_random_uuid());
    v_revision_id := gen_random_uuid();
    insert into public.builder_forms (
      site_id, id, form_key, template_id, template_version, draft_revision_id,
      record_version, created_by, updated_by
    ) values (
      v_site_id, v_form_id, p_request ->> 'formKey', p_request ->> 'templateId',
      p_request ->> 'templateVersion', v_revision_id, 1, v_actor_id, v_actor_id
    );
    insert into public.builder_form_revisions (
      site_id, form_id, id, revision_number, template_id, template_version,
      contract_digest, schema_version, configuration, created_by
    ) values (
      v_site_id, v_form_id, v_revision_id, 1, p_request ->> 'templateId',
      p_request ->> 'templateVersion', p_request ->> 'contractDigest',
      coalesce((p_request ->> 'schemaVersion')::integer, 1), p_request -> 'configuration', v_actor_id
    );
    perform builder_private.append_form_event(
      v_site_id, v_form_id, p_request, 'created', null, 1, v_actor_id, 'OWNER_CREATED',
      jsonb_build_object('revisionNumber', 1)
    );
    return jsonb_build_object(
      'version', 1, 'status', 'created', 'formId', v_form_id,
      'draftRevisionId', v_revision_id, 'recordVersion', 1
    );
  end if;

  select form_row.* into v_form
  from public.builder_forms form_row
  where form_row.site_id = v_site_id and form_row.id = v_form_id
  for update;
  if not found then raise exception 'form identity not found' using errcode = '22023'; end if;
  if v_form.record_version <> v_expected_version then
    raise exception 'form record version conflict' using errcode = '40001';
  end if;

  v_new_version := v_form.record_version + 1;

  if v_action = 'save' then
    if not (p_request ?& array['contractDigest', 'configuration'])
      or (p_request ->> 'contractDigest') !~ '^[a-f0-9]{64}$'
      or not builder_private.validate_managed_form_configuration(p_request -> 'configuration')
      or (p_request #>> '{configuration,templateId}') <> v_form.template_id
      or (p_request #>> '{configuration,templateVersion}') <> v_form.template_version
    then raise exception 'invalid save form command' using errcode = '22023'; end if;
    select coalesce(max(revision_number), 0) + 1 into v_revision_number
    from public.builder_form_revisions where site_id = v_site_id and form_id = v_form_id;
    v_revision_id := gen_random_uuid();
    insert into public.builder_form_revisions (
      site_id, form_id, id, revision_number, template_id, template_version,
      contract_digest, schema_version, configuration, created_by
    ) values (
      v_site_id, v_form_id, v_revision_id, v_revision_number, v_form.template_id,
      v_form.template_version, p_request ->> 'contractDigest',
      coalesce((p_request ->> 'schemaVersion')::integer, 1), p_request -> 'configuration', v_actor_id
    );
    update public.builder_forms
    set draft_revision_id = v_revision_id, record_version = v_new_version,
        updated_by = v_actor_id, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_form_id;
    perform builder_private.append_form_event(
      v_site_id, v_form_id, p_request, 'draft_saved', v_form.record_version,
      v_new_version, v_actor_id, 'DRAFT_SAVED', jsonb_build_object('revisionNumber', v_revision_number)
    );
    v_result := jsonb_build_object('status', 'saved', 'draftRevisionId', v_revision_id);

  elsif v_action = 'publish' then
    if v_form.activation_state = 'archived' or v_form.draft_revision_id is null then
      raise exception 'form has no publishable draft' using errcode = '22023';
    end if;
    select revision.* into v_revision from public.builder_form_revisions revision
    where revision.site_id = v_site_id and revision.form_id = v_form_id and revision.id = v_form.draft_revision_id;
    if not found
      or not builder_private.validate_managed_form_configuration(v_revision.configuration)
      or (p_request ? 'expectedContractDigest' and p_request ->> 'expectedContractDigest' <> v_revision.contract_digest)
      or (p_request ? 'expectedTemplateVersion' and p_request ->> 'expectedTemplateVersion' <> v_revision.template_version)
    then raise exception 'form draft is incompatible' using errcode = '22023'; end if;
    update public.builder_forms
    set published_revision_id = v_form.draft_revision_id, draft_revision_id = null,
        record_version = v_new_version, updated_by = v_actor_id, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_form_id;
    perform builder_private.append_form_event(
      v_site_id, v_form_id, p_request, 'published', v_form.record_version,
      v_new_version, v_actor_id, 'PUBLISHED', jsonb_build_object('revisionNumber', v_revision.revision_number)
    );
    v_result := jsonb_build_object('status', 'published', 'publishedRevisionId', v_form.draft_revision_id);

  elsif v_action = 'pause' then
    if v_form.activation_state <> 'active' then raise exception 'form is not active' using errcode = '22023'; end if;
    update public.builder_forms set activation_state = 'paused', record_version = v_new_version,
      updated_by = v_actor_id, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_form_id;
    perform builder_private.append_form_event(
      v_site_id, v_form_id, p_request, 'paused', v_form.record_version,
      v_new_version, v_actor_id, 'PAUSED', '{}'::jsonb
    );
    v_result := jsonb_build_object('status', 'paused');

  elsif v_action = 'resume' then
    if v_form.activation_state <> 'paused' or v_form.published_revision_id is null then
      raise exception 'form is not resumable' using errcode = '22023';
    end if;
    update public.builder_forms set activation_state = 'active', record_version = v_new_version,
      updated_by = v_actor_id, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_form_id;
    perform builder_private.append_form_event(
      v_site_id, v_form_id, p_request, 'resumed', v_form.record_version,
      v_new_version, v_actor_id, 'RESUMED', '{}'::jsonb
    );
    v_result := jsonb_build_object('status', 'active');

  elsif v_action = 'restore' then
    select revision.* into v_revision from public.builder_form_revisions revision
    where revision.site_id = v_site_id and revision.form_id = v_form_id and revision.id = v_source_revision_id;
    if not found or v_revision.template_id <> v_form.template_id
      or v_revision.template_version <> v_form.template_version
      or not builder_private.validate_managed_form_configuration(v_revision.configuration)
    then raise exception 'form revision is incompatible' using errcode = '22023'; end if;
    select coalesce(max(revision_number), 0) + 1 into v_revision_number
    from public.builder_form_revisions where site_id = v_site_id and form_id = v_form_id;
    v_revision_id := gen_random_uuid();
    insert into public.builder_form_revisions (
      site_id, form_id, id, revision_number, template_id, template_version,
      contract_digest, schema_version, configuration, created_by
    ) values (
      v_site_id, v_form_id, v_revision_id, v_revision_number, v_revision.template_id,
      v_revision.template_version, v_revision.contract_digest, v_revision.schema_version,
      v_revision.configuration, v_actor_id
    );
    update public.builder_forms set draft_revision_id = v_revision_id,
      record_version = v_new_version, updated_by = v_actor_id, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_form_id;
    perform builder_private.append_form_event(
      v_site_id, v_form_id, p_request, 'restored', v_form.record_version,
      v_new_version, v_actor_id, 'RESTORED',
      jsonb_build_object('sourceRevisionId', v_source_revision_id, 'revisionNumber', v_revision_number)
    );
    v_result := jsonb_build_object('status', 'restored', 'draftRevisionId', v_revision_id);

  elsif v_action = 'archive' then
    v_reason_code := p_request ->> 'reasonCode';
    if v_form.activation_state = 'archived' or v_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
      raise exception 'invalid archive form command' using errcode = '22023';
    end if;
    update public.builder_forms set activation_state = 'archived', record_version = v_new_version,
      updated_by = v_actor_id, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_form_id;
    perform builder_private.append_form_event(
      v_site_id, v_form_id, p_request, 'archived', v_form.record_version,
      v_new_version, v_actor_id, v_reason_code, '{}'::jsonb
    );
    v_result := jsonb_build_object('status', 'archived');

  else
    if v_form.activation_state <> 'archived' then raise exception 'form is not archived' using errcode = '22023'; end if;
    update public.builder_forms set activation_state = 'paused', record_version = v_new_version,
      updated_by = v_actor_id, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_form_id;
    perform builder_private.append_form_event(
      v_site_id, v_form_id, p_request, 'unarchived', v_form.record_version,
      v_new_version, v_actor_id, 'UNARCHIVED', '{}'::jsonb
    );
    v_result := jsonb_build_object('status', 'paused');
  end if;

  return jsonb_build_object(
    'version', 1, 'formId', v_form_id, 'recordVersion', v_new_version
  ) || v_result;
end;
$$;

create function public.builder_list_forms_v1(p_site_id uuid)
returns table (
  id uuid,
  form_key text,
  template_id text,
  template_version text,
  activation_state text,
  draft_revision_id uuid,
  published_revision_id uuid,
  record_version integer,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select form_row.id, form_row.form_key, form_row.template_id, form_row.template_version,
    form_row.activation_state, form_row.draft_revision_id, form_row.published_revision_id,
    form_row.record_version, form_row.updated_at
  from public.builder_forms form_row
  where form_row.site_id = p_site_id
  order by form_row.updated_at desc, form_row.id;
$$;

create function public.builder_get_form_v1(p_site_id uuid, p_form_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'form', jsonb_build_object(
      'id', form_row.id,
      'formKey', form_row.form_key,
      'templateId', form_row.template_id,
      'templateVersion', form_row.template_version,
      'activationState', form_row.activation_state,
      'draftRevisionId', form_row.draft_revision_id,
      'publishedRevisionId', form_row.published_revision_id,
      'recordVersion', form_row.record_version,
      'updatedAt', form_row.updated_at
    ),
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', revision.id,
        'revisionNumber', revision.revision_number,
        'templateId', revision.template_id,
        'templateVersion', revision.template_version,
        'contractDigest', revision.contract_digest,
        'schemaVersion', revision.schema_version,
        'configuration', revision.configuration,
        'createdBy', revision.created_by,
        'createdAt', revision.created_at
      ) order by revision.revision_number desc)
      from public.builder_form_revisions revision
      where revision.site_id = form_row.site_id and revision.form_id = form_row.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'eventKind', event.event_kind,
        'actorId', event.actor_id,
        'priorRecordVersion', event.prior_record_version,
        'newRecordVersion', event.new_record_version,
        'reasonCode', event.reason_code,
        'safeMetadata', event.safe_metadata,
        'createdAt', event.created_at
      ) order by event.created_at desc, event.id desc)
      from public.builder_form_events event
      where event.site_id = form_row.site_id and event.form_id = form_row.id
    ), '[]'::jsonb)
  )
  from public.builder_forms form_row
  where form_row.site_id = p_site_id and form_row.id = p_form_id;
$$;

create function public.builder_get_published_form_v1(p_site_id uuid, p_form_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'formId', form_row.id,
    'formKey', form_row.form_key,
    'revisionId', revision.id,
    'revisionNumber', revision.revision_number,
    'templateId', revision.template_id,
    'templateVersion', revision.template_version,
    'contractDigest', revision.contract_digest,
    'configuration', revision.configuration
  )
  from public.builder_forms form_row
  join public.builder_form_revisions revision
    on revision.site_id = form_row.site_id
   and revision.form_id = form_row.id
   and revision.id = form_row.published_revision_id
  where form_row.site_id = p_site_id
    and form_row.form_key = p_form_key
    and form_row.activation_state = 'active';
$$;

revoke all on function public.builder_list_forms_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function public.builder_get_form_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.builder_get_published_form_v1(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.builder_list_forms_v1(uuid) to authenticated, service_role;
grant execute on function public.builder_get_form_v1(uuid, uuid) to authenticated, service_role;
grant execute on function public.builder_get_published_form_v1(uuid, text) to service_role;

create function public.builder_ingest_form_submission_v2(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_form_id uuid;
  v_revision_id uuid;
  v_idempotency_key uuid;
  v_receipt_id uuid;
  v_submitted_at timestamptz;
  v_captured_at timestamptz;
  v_form_key text;
  v_template_id text;
  v_template_version text;
  v_source_page text;
  v_locale text;
  v_qualification_result text;
  v_request_fingerprint text;
  v_payload jsonb;
  v_consent jsonb;
  v_rate_limits jsonb;
  v_payload_byte_length integer;
  v_field_count integer;
  v_form public.builder_forms%rowtype;
  v_revision public.builder_form_revisions%rowtype;
  v_existing_receipt builder_private.builder_ingestion_receipts%rowtype;
  v_rate jsonb;
  v_bucket_key text;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_limit integer;
  v_rate_count integer;
  v_submission_id uuid := gen_random_uuid();
  v_consent_id uuid := gen_random_uuid();
  v_result_id uuid := gen_random_uuid();
  v_result_code text := 'base_only';
  v_safe_code text := 'enhancement_unavailable';
  v_entitlement_decision text := 'base_only';
  v_first_name text;
  v_last_name text;
  v_display_name text;
  v_email text;
  v_phone text;
  v_zip text;
  v_topic text;
  v_message text;
  v_urgency text;
  v_email_contact_id uuid;
  v_phone_contact_id uuid;
  v_review_contact_id uuid;
  v_contact_id uuid;
  v_lead_id uuid;
  v_channel text;
  v_constraint_name text;
begin
  if jsonb_typeof(p_request) <> 'object'
    or octet_length(p_request::text) > 65536
    or not (p_request ?& array[
      'version', 'siteId', 'formId', 'formKey', 'formRevisionId',
      'templateId', 'templateVersion', 'sourcePage', 'idempotencyKey',
      'requestFingerprint', 'submittedAt', 'locale', 'qualificationResult',
      'payload', 'payloadByteLength', 'fieldCount', 'consentEvidence',
      'securityReceiptId', 'rateLimits'
    ])
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_request) key
      where key <> all(array[
        'version', 'siteId', 'formId', 'formKey', 'formRevisionId',
        'templateId', 'templateVersion', 'sourcePage', 'idempotencyKey',
        'requestFingerprint', 'submittedAt', 'locale', 'qualificationResult',
        'payload', 'payloadByteLength', 'fieldCount', 'consentEvidence',
        'securityReceiptId', 'rateLimits'
      ])
    )
  then raise exception 'invalid version 2 ingestion payload' using errcode = '22023'; end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_form_id := (p_request ->> 'formId')::uuid;
    v_revision_id := (p_request ->> 'formRevisionId')::uuid;
    v_idempotency_key := (p_request ->> 'idempotencyKey')::uuid;
    v_receipt_id := (p_request ->> 'securityReceiptId')::uuid;
    v_submitted_at := (p_request ->> 'submittedAt')::timestamptz;
    v_form_key := p_request ->> 'formKey';
    v_template_id := p_request ->> 'templateId';
    v_template_version := p_request ->> 'templateVersion';
    v_source_page := p_request ->> 'sourcePage';
    v_locale := p_request ->> 'locale';
    v_qualification_result := p_request ->> 'qualificationResult';
    v_request_fingerprint := p_request ->> 'requestFingerprint';
    v_payload := p_request -> 'payload';
    v_payload_byte_length := (p_request ->> 'payloadByteLength')::integer;
    v_field_count := (p_request ->> 'fieldCount')::integer;
    v_consent := p_request -> 'consentEvidence';
    v_captured_at := (v_consent ->> 'capturedAt')::timestamptz;
    v_rate_limits := p_request -> 'rateLimits';
  exception when others then
    raise exception 'invalid version 2 ingestion payload' using errcode = '22023';
  end;

  if (p_request ->> 'version') <> '2'
    or v_form_key !~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'
    or v_template_id !~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
    or v_template_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
    or v_source_page !~ '^/(?!/)[^?]*$'
    or v_locale !~ '^[A-Za-z]{2}(-[A-Za-z0-9]{2,8})?$'
    or v_qualification_result not in ('in_area', 'out_of_area', 'not_configured')
    or v_request_fingerprint !~ '^[a-f0-9]{64}$'
    or v_submitted_at < statement_timestamp() - interval '24 hours'
    or v_submitted_at > statement_timestamp() + interval '5 minutes'
    or v_captured_at < v_submitted_at - interval '5 minutes'
    or v_captured_at > statement_timestamp() + interval '5 minutes'
    or jsonb_typeof(v_payload) <> 'object'
    or v_payload_byte_length not between 2 and 32768
    or v_field_count not between 1 and 32
    or v_field_count <> (select count(*) from pg_catalog.jsonb_object_keys(v_payload))
    or octet_length(v_payload::text) > 32768
    or jsonb_typeof(v_consent) <> 'object'
    or not (v_consent ?& array['policyVersion', 'purpose', 'languageDigest', 'source', 'capturedAt'])
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(v_consent) key
      where key <> all(array['policyVersion', 'purpose', 'languageDigest', 'source', 'capturedAt'])
    )
    or (v_consent ->> 'policyVersion') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
    or (v_consent ->> 'purpose') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
    or (v_consent ->> 'languageDigest') !~ '^[a-f0-9]{64}$'
    or (v_consent ->> 'source') <> 'public_form'
    or jsonb_typeof(v_rate_limits) <> 'array'
    or jsonb_array_length(v_rate_limits) not between 1 and 2
  then raise exception 'invalid version 2 ingestion payload' using errcode = '22023'; end if;

  select form_row.* into v_form
  from public.builder_forms form_row
  where form_row.site_id = v_site_id and form_row.id = v_form_id
  for share;
  if not found
    or v_form.form_key <> v_form_key
    or v_form.template_id <> v_template_id
    or v_form.template_version <> v_template_version
    or v_form.activation_state <> 'active'
    or v_form.published_revision_id <> v_revision_id
  then raise exception 'form revision is not accepting submissions' using errcode = '22023'; end if;

  select revision.* into v_revision
  from public.builder_form_revisions revision
  where revision.site_id = v_site_id and revision.form_id = v_form_id and revision.id = v_revision_id;
  if not found
    or v_revision.template_id <> v_template_id
    or v_revision.template_version <> v_template_version
    or not builder_private.validate_managed_form_configuration(v_revision.configuration)
  then raise exception 'form revision is incompatible' using errcode = '22023'; end if;

  select receipt.* into v_existing_receipt
  from builder_private.builder_ingestion_receipts receipt
  where receipt.site_id = v_site_id and receipt.idempotency_key = v_idempotency_key::text
  for update;
  if found then
    if v_existing_receipt.request_fingerprint <> v_request_fingerprint then
      raise exception 'ingestion idempotency conflict' using errcode = 'P2F09';
    end if;
    return jsonb_build_object(
      'version', 2, 'accepted', true, 'receiptId', v_existing_receipt.id,
      'submissionId', v_existing_receipt.submission_id, 'result', 'replayed'
    );
  end if;

  insert into builder_private.builder_ingestion_receipts (
    site_id, id, idempotency_key, request_fingerprint, safe_result_code,
    entitlement_decision, expires_at
  ) values (
    v_site_id, v_receipt_id, v_idempotency_key::text, v_request_fingerprint,
    'enhancement_unavailable', 'base_only', statement_timestamp() + interval '24 hours'
  ) on conflict (site_id, idempotency_key) do nothing
  returning * into v_existing_receipt;
  if not found then
    select receipt.* into v_existing_receipt
    from builder_private.builder_ingestion_receipts receipt
    where receipt.site_id = v_site_id and receipt.idempotency_key = v_idempotency_key::text
    for update;
    if v_existing_receipt.request_fingerprint <> v_request_fingerprint then
      raise exception 'ingestion idempotency conflict' using errcode = 'P2F09';
    end if;
    return jsonb_build_object(
      'version', 2, 'accepted', true, 'receiptId', v_existing_receipt.id,
      'submissionId', v_existing_receipt.submission_id, 'result', 'replayed'
    );
  end if;

  for v_rate in select value from pg_catalog.jsonb_array_elements(v_rate_limits) loop
    begin
      if jsonb_typeof(v_rate) <> 'object'
        or not (v_rate ?& array['kind', 'bucketKeyHmac', 'windowStartedAt', 'windowEndsAt', 'limit'])
        or (v_rate ->> 'kind') not in ('network', 'identity')
      then raise exception 'invalid'; end if;
      v_bucket_key := v_rate ->> 'bucketKeyHmac';
      v_window_start := (v_rate ->> 'windowStartedAt')::timestamptz;
      v_window_end := (v_rate ->> 'windowEndsAt')::timestamptz;
      v_limit := (v_rate ->> 'limit')::integer;
    exception when others then
      raise exception 'invalid version 2 rate-limit evidence' using errcode = '22023';
    end;
    if v_bucket_key !~ '^[a-f0-9]{64}$' or v_limit not between 1 and 100
      or v_window_start > statement_timestamp() + interval '5 minutes'
      or v_window_start < statement_timestamp() - interval '24 hours'
      or v_window_end <= statement_timestamp()
      or v_window_end <> v_window_start + (case
        when (v_rate ->> 'kind') = 'network' then interval '1 hour'
        else interval '15 minutes'
      end)
    then raise exception 'invalid version 2 rate-limit evidence' using errcode = '22023'; end if;
    v_rate_count := null;
    insert into builder_private.builder_rate_limit_buckets (
      site_id, bucket_key_hmac, window_started_at, window_ends_at, request_count, updated_at
    ) values (v_site_id, v_bucket_key, v_window_start, v_window_end, 1, statement_timestamp())
    on conflict (site_id, bucket_key_hmac, window_started_at) do update
      set request_count = builder_private.builder_rate_limit_buckets.request_count + 1,
          updated_at = statement_timestamp()
      where builder_private.builder_rate_limit_buckets.request_count < v_limit
        and builder_private.builder_rate_limit_buckets.window_ends_at = excluded.window_ends_at
    returning request_count into v_rate_count;
    if v_rate_count is null or v_rate_count > v_limit then
      raise exception 'ingestion rate limit exceeded' using errcode = 'P2F29';
    end if;
  end loop;

  insert into public.builder_form_submissions (
    site_id, id, form_id, idempotency_key, payload, source, zip_code, locale, received_at,
    form_identity_id, form_revision_id, template_id, template_version, contract_digest,
    ingestion_contract_version, qualification_result, source_page, security_receipt_id
  ) values (
    v_site_id, v_submission_id, v_form_key, v_idempotency_key::text, v_payload,
    'public_form', nullif(v_payload ->> 'zipCode', ''), v_locale, v_submitted_at,
    v_form_id, v_revision_id, v_template_id, v_template_version, v_revision.contract_digest,
    2, v_qualification_result, v_source_page, v_receipt_id
  );

  insert into public.builder_form_submission_consents (
    site_id, id, submission_id, policy_version, purpose, language_digest, source, captured_at
  ) values (
    v_site_id, v_consent_id, v_submission_id, v_consent ->> 'policyVersion',
    v_consent ->> 'purpose', v_consent ->> 'languageDigest', 'public_form', v_captured_at
  );

  insert into public.builder_form_submission_events (site_id, submission_id, event_kind, metadata)
  values (
    v_site_id, v_submission_id, 'reviewed',
    jsonb_build_object('version', 2, 'safeCode', 'accepted', 'qualificationResult', v_qualification_result)
  );

  if v_template_id <> 'local-business.newsletter-signup'
    and builder_private.dependent_action_allowed(v_site_id, 'growth.customers', 'growth.leads', 'write')
  then
    v_first_name := nullif(btrim(v_payload ->> 'firstName'), '');
    v_last_name := nullif(btrim(v_payload ->> 'lastName'), '');
    v_email := nullif(lower(btrim(v_payload ->> 'email')), '');
    v_phone := nullif(btrim(v_payload ->> 'phone'), '');
    v_zip := nullif(v_payload ->> 'zipCode', '');
    v_topic := coalesce(nullif(v_payload ->> 'serviceId', ''), nullif(v_payload ->> 'projectTypeId', ''), nullif(v_payload ->> 'subject', ''));
    v_message := nullif(btrim(v_payload ->> 'message'), '');
    v_urgency := case v_payload ->> 'urgency'
      when 'urgent' then 'high' when 'emergency' then 'emergency' else 'normal' end;
    if v_first_name is null or v_last_name is null or (v_email is null and v_phone is null)
      or v_topic is null or v_message is null
    then raise exception 'trusted enhanced form payload is incomplete' using errcode = '22023'; end if;
    v_display_name := v_first_name || ' ' || v_last_name;

    select identity.contact_id into v_email_contact_id
    from public.builder_contact_identities identity
    where identity.site_id = v_site_id and identity.kind = 'email' and identity.normalized_value = v_email;
    select identity.contact_id into v_phone_contact_id
    from public.builder_contact_identities identity
    where identity.site_id = v_site_id and identity.kind = 'phone' and identity.normalized_value = v_phone;

    if v_email_contact_id is not null and v_phone_contact_id is not null
      and v_email_contact_id <> v_phone_contact_id
    then
      v_result_code := 'identity_conflict'; v_safe_code := 'identity_conflict'; v_entitlement_decision := 'review';
    else
      v_contact_id := coalesce(v_email_contact_id, v_phone_contact_id);
      if v_contact_id is null then
        select contact.id into v_review_contact_id from public.builder_contacts contact
        where contact.site_id = v_site_id and lower(contact.display_name) = lower(v_display_name)
          and contact.service_zip_code is not distinct from v_zip and contact.lifecycle_state = 'active'
        order by contact.id limit 1;
      end if;
      if v_review_contact_id is not null then
        v_result_code := 'review_required'; v_safe_code := 'review_suggested'; v_entitlement_decision := 'review';
      else
        begin
          if v_contact_id is null then
            v_contact_id := gen_random_uuid();
            insert into public.builder_contacts (
              site_id, id, display_name, preferred_contact_method, service_zip_code
            ) values (
              v_site_id, v_contact_id, v_display_name,
              case when v_email is not null then 'email' else 'phone' end, v_zip
            );
          end if;
          if v_email is not null and v_email_contact_id is null then
            insert into public.builder_contact_identities (
              site_id, contact_id, kind, normalized_value, verification_state, source
            ) values (v_site_id, v_contact_id, 'email', v_email, 'unverified', 'public_form');
          end if;
          if v_phone is not null and v_phone_contact_id is null then
            insert into public.builder_contact_identities (
              site_id, contact_id, kind, normalized_value, verification_state, source
            ) values (v_site_id, v_contact_id, 'phone', v_phone, 'unverified', 'public_form');
          end if;
          v_lead_id := gen_random_uuid();
          insert into public.builder_leads (
            site_id, id, contact_id, source, form_id, service, urgency, status, summary
          ) values (
            v_site_id, v_lead_id, v_contact_id, 'public_form', v_form_key,
            v_topic, v_urgency, 'new', v_message
          );
          v_channel := case when v_email is not null then 'email' else 'phone' end;
          insert into public.builder_consents (
            site_id, contact_id, base_consent_id, purpose, channel, state, captured_at
          ) values (
            v_site_id, v_contact_id, v_consent_id, v_consent ->> 'purpose',
            v_channel, 'granted', v_captured_at
          );
          insert into public.builder_lead_events (site_id, lead_id, event_kind, metadata)
          values (
            v_site_id, v_lead_id, 'created',
            jsonb_build_object('version', 2, 'source', 'public_form', 'submissionId', v_submission_id)
          );
          insert into public.builder_outbox (
            site_id, topic, payload, idempotency_key, schema_version,
            aggregate_type, aggregate_id, correlation_id
          ) values (
            v_site_id, 'growth.lead.created',
            jsonb_build_object('version', 2, 'submissionId', v_submission_id, 'contactId', v_contact_id, 'leadId', v_lead_id),
            'growth.forms.v2:' || v_idempotency_key::text, 2, 'lead', v_lead_id, v_receipt_id
          );
          v_result_code := 'enhanced'; v_safe_code := 'enhanced'; v_entitlement_decision := 'enhanced';
        exception
          when sqlstate 'P2B01' then
            v_contact_id := null; v_lead_id := null;
            v_result_code := 'review_required'; v_safe_code := 'review_suggested'; v_entitlement_decision := 'review';
          when unique_violation then
            get stacked diagnostics v_constraint_name = constraint_name;
            if v_constraint_name <> 'builder_contact_identities_site_id_kind_normalized_value_key' then raise; end if;
            v_contact_id := null; v_lead_id := null;
            v_result_code := 'review_required'; v_safe_code := 'review_suggested'; v_entitlement_decision := 'review';
        end;
      end if;
    end if;
  end if;

  insert into public.builder_form_submission_results (
    site_id, id, submission_id, version, result_code, contact_id, lead_id, safe_metadata
  ) values (
    v_site_id, v_result_id, v_submission_id, 1, v_result_code, v_contact_id, v_lead_id,
    jsonb_build_object('safeCode', v_safe_code, 'qualificationResult', v_qualification_result)
  );

  if v_entitlement_decision = 'review' then
    insert into public.builder_form_submission_events (site_id, submission_id, event_kind, metadata)
    values (v_site_id, v_submission_id, 'reviewed', jsonb_build_object('version', 2, 'safeCode', v_safe_code));
  elsif v_entitlement_decision = 'base_only' and v_template_id <> 'local-business.newsletter-signup' then
    insert into public.builder_health_checks (site_id, check_kind, status, safe_code, observed_at)
    values (v_site_id, 'ingestion.enhancement', 'degraded', 'ENHANCEMENT_UNAVAILABLE', statement_timestamp());
  end if;

  update builder_private.builder_ingestion_receipts
  set safe_result_code = v_safe_code, entitlement_decision = v_entitlement_decision,
      submission_id = v_submission_id
  where site_id = v_site_id and id = v_receipt_id;

  return jsonb_build_object(
    'version', 2, 'accepted', true, 'receiptId', v_receipt_id,
    'submissionId', v_submission_id, 'qualificationResult', v_qualification_result,
    'result', 'accepted', 'processing', v_safe_code
  );
end;
$$;

revoke all on function builder_private.form_command_digest(jsonb)
from public, anon, authenticated, service_role;
revoke all on function builder_private.append_form_event(uuid, uuid, jsonb, text, integer, integer, uuid, text, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.builder_reconcile_core_website_forms_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_apply_form_command_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_ingest_form_submission_v2(jsonb)
from public, anon, authenticated;
grant execute on function public.builder_reconcile_core_website_forms_v1(jsonb) to service_role;
grant execute on function public.builder_apply_form_command_v1(jsonb) to service_role;
grant execute on function public.builder_ingest_form_submission_v2(jsonb) to service_role;
