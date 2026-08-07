do $migration$
declare
  v_site_id uuid;
  v_owner_id uuid;
  v_form public.builder_forms%rowtype;
  v_result jsonb;
  v_configuration jsonb := $json${
    "templateId":"local-business.newsletter-signup",
    "templateVersion":"1.0.0",
    "displayName":"District Newsletter",
    "fields":[
      {"key":"email","label":"Email address","helpText":"","placeholder":"you@example.com","visible":true,"required":true},
      {"key":"firstName","label":"First name","helpText":"","placeholder":"First name","visible":true,"required":false},
      {"key":"marketingConsent","label":"I agree to receive District Newsletter emails from the Office of Assemblywoman Carmen Morales. I understand that submitting this form is a confirmation request, that I am not subscribed until I confirm by email, and that I can unsubscribe at any time.","helpText":"","placeholder":"","visible":true,"required":true}
    ],
    "qualification":{"enabled":false,"allowedZipCodes":[]},
    "completion":{"mode":"inline_success","successCopy":"Check your inbox to continue. Your request is pending, and you are not subscribed unless you complete the confirmation step."},
    "consentPolicyVersion":"marketing-v1"
  }$json$::jsonb;
  v_contract_digest text := '285bb0c54a09990f82614061e17a0ce4e50c00b178d65bb4e7a1d033e74e04af';
begin
  select site.id into v_site_id
  from public.builder_sites site
  where site.site_key = 'official-assembly-website-v2';

  -- Local schema-only resets do not provision a client site. Production must.
  if v_site_id is null then
    raise notice 'approved newsletter form publication skipped: client site is not provisioned';
    return;
  end if;

  select form_row.* into v_form
  from public.builder_forms form_row
  where form_row.site_id = v_site_id
    and form_row.form_key = 'newsletter-signup'
  for update;
  if not found
    or v_form.template_id <> 'local-business.newsletter-signup'
    or v_form.template_version <> '1.0.0'
    or v_form.activation_state = 'archived'
  then
    raise exception 'approved newsletter form is not provisioned' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.builder_form_revisions revision
    where revision.site_id = v_site_id
      and revision.form_id = v_form.id
      and revision.id = v_form.published_revision_id
      and revision.contract_digest = v_contract_digest
      and revision.configuration = v_configuration
  ) then
    raise notice 'approved newsletter form publication already current';
    return;
  end if;

  select member.user_id into v_owner_id
  from public.builder_site_members member
  where member.site_id = v_site_id
    and member.role = 'owner'
    and builder_private.member_has_website_capability(
      member.site_id, member.user_id, 'forms.editDraft'
    )
    and builder_private.member_has_website_capability(
      member.site_id, member.user_id, 'forms.publish'
    )
  order by member.created_at, member.user_id
  limit 1;
  if v_owner_id is null then
    raise exception 'approved newsletter form owner is unavailable' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.builder_form_revisions revision
    where revision.site_id = v_site_id
      and revision.form_id = v_form.id
      and revision.id = v_form.draft_revision_id
      and revision.contract_digest = v_contract_digest
      and revision.configuration = v_configuration
  ) then
    v_result := public.builder_apply_form_command_v1(jsonb_build_object(
      'version', 1,
      'commandId', '39100000-0000-4000-8000-000000000241',
      'idempotencyKey', 'migration:20260807191500:newsletter-approved-save',
      'siteId', v_site_id,
      'actorId', v_owner_id,
      'action', 'save',
      'expectedVersion', v_form.record_version,
      'formId', v_form.id,
      'contractDigest', v_contract_digest,
      'schemaVersion', 1,
      'configuration', v_configuration
    ));
    if (v_result ->> 'status') not in ('saved', 'replayed') then
      raise exception 'approved newsletter form save failed' using errcode = '55000';
    end if;
    v_form.record_version := (v_result ->> 'recordVersion')::integer;
  end if;

  v_result := public.builder_apply_form_command_v1(jsonb_build_object(
    'version', 1,
    'commandId', '39100000-0000-4000-8000-000000000242',
    'idempotencyKey', 'migration:20260807191500:newsletter-approved-publish',
    'siteId', v_site_id,
    'actorId', v_owner_id,
    'action', 'publish',
    'expectedVersion', v_form.record_version,
    'formId', v_form.id,
    'expectedContractDigest', v_contract_digest,
    'expectedTemplateVersion', '1.0.0'
  ));
  if (v_result ->> 'status') not in ('published', 'replayed') then
    raise exception 'approved newsletter form publish failed' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.builder_forms form_row
    join public.builder_form_revisions revision
      on revision.site_id = form_row.site_id
      and revision.form_id = form_row.id
      and revision.id = form_row.published_revision_id
    where form_row.site_id = v_site_id
      and form_row.id = v_form.id
      and revision.contract_digest = v_contract_digest
      and revision.configuration = v_configuration
  ) then
    raise exception 'approved newsletter form publication verification failed' using errcode = '55000';
  end if;

  raise notice 'approved newsletter form revision published';
end;
$migration$;
