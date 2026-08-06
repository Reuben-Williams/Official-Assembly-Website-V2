-- Live newsletter state is deliberately isolated from browser roles.  Public
-- forms enter through a server-owned RPC and every provider side effect is a
-- durable, fenced job.

create table public.builder_newsletter_subscriptions (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  contact_id uuid not null,
  current_consent_id uuid not null,
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation', 'confirmed_pending_provider', 'active', 'unsubscribed', 'suppressed')),
  current_generation integer not null default 1 check (current_generation > 0),
  provider_contact_id text,
  provider_segment_id text,
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, contact_id),
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, current_consent_id)
    references public.builder_consents(site_id, id) on delete restrict
);

create table public.builder_newsletter_confirmation_generations (
  site_id uuid not null,
  subscription_id uuid not null,
  generation integer not null check (generation > 0),
  nonce text not null check (char_length(nonce) between 32 and 128),
  signing_key_id text not null check (signing_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, subscription_id, generation),
  unique (site_id, subscription_id, nonce),
  foreign key (site_id, subscription_id)
    references public.builder_newsletter_subscriptions(site_id, id) on delete cascade,
  check (expires_at > issued_at)
);

create table builder_private.builder_newsletter_delivery_ledger (
  site_id uuid not null,
  subscription_id uuid not null,
  confirmation_generation integer not null check (confirmation_generation > 0),
  delivery_ordinal integer not null check (delivery_ordinal > 0),
  source_receipt_id uuid not null,
  address_fingerprint text not null check (address_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, subscription_id, confirmation_generation, delivery_ordinal),
  unique (site_id, source_receipt_id),
  foreign key (site_id, subscription_id, confirmation_generation)
    references public.builder_newsletter_confirmation_generations(site_id, subscription_id, generation)
    on delete restrict,
  foreign key (site_id, source_receipt_id)
    references builder_private.builder_ingestion_receipts(site_id, id) on delete restrict
);

create table builder_private.builder_newsletter_confirmation_sessions (
  site_id uuid not null,
  id uuid not null default extensions.gen_random_uuid(),
  subscription_id uuid not null,
  confirmation_generation integer not null,
  session_digest text not null check (session_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, session_digest),
  foreign key (site_id, subscription_id, confirmation_generation)
    references public.builder_newsletter_confirmation_generations(site_id, subscription_id, generation)
    on delete restrict
);

create table public.builder_newsletter_jobs (
  site_id uuid not null,
  id uuid not null default extensions.gen_random_uuid(),
  subscription_id uuid not null,
  kind text not null check (kind in (
    'newsletter.confirmation.send', 'newsletter.contact.sync', 'newsletter.contact.audit'
  )),
  confirmation_generation integer,
  delivery_ordinal integer,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  state text not null default 'queued'
    check (state in ('queued', 'leased', 'retryable_failed', 'completed', 'terminal_failed')),
  available_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner uuid,
  lease_fencing_token bigint not null default 0 check (lease_fencing_token >= 0),
  lease_expires_at timestamptz,
  safe_result_code text,
  safe_failure_code text check (safe_failure_code is null or safe_failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, subscription_id)
    references public.builder_newsletter_subscriptions(site_id, id) on delete cascade,
  foreign key (site_id, subscription_id, confirmation_generation)
    references public.builder_newsletter_confirmation_generations(site_id, subscription_id, generation)
    on delete restrict,
  check (
    (kind = 'newsletter.confirmation.send' and confirmation_generation is not null and delivery_ordinal is not null)
    or
    (kind <> 'newsletter.confirmation.send' and confirmation_generation is null and delivery_ordinal is null)
  ),
  check ((state = 'leased') = (lease_owner is not null and lease_expires_at is not null))
);

create table public.builder_newsletter_site_jobs (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  provider_scope_id text not null check (char_length(provider_scope_id) between 1 and 160),
  kind text not null check (kind in ('newsletter.contact.audit', 'newsletter.segment.reconcile')),
  subscription_id uuid,
  validation_id uuid,
  state text not null default 'queued'
    check (state in ('queued', 'leased', 'retryable_failed', 'completed', 'terminal_failed')),
  available_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner uuid,
  lease_fencing_token bigint not null default 0 check (lease_fencing_token >= 0),
  lease_expires_at timestamptz,
  safe_result_code text,
  safe_failure_code text check (safe_failure_code is null or safe_failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  check (subscription_id is null and validation_id is null),
  check ((state = 'leased') = (lease_owner is not null and lease_expires_at is not null))
);

create table public.builder_newsletter_broadcast_audit_jobs (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  provider_scope_id text not null check (char_length(provider_scope_id) between 1 and 160),
  kind text not null default 'newsletter.broadcast.audit'
    check (kind = 'newsletter.broadcast.audit'),
  validation_id uuid,
  activation_cutoff timestamptz not null default clock_timestamp(),
  state text not null default 'queued'
    check (state in ('queued', 'leased', 'retryable_failed', 'completed', 'terminal_failed')),
  available_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner uuid,
  lease_fencing_token bigint not null default 0 check (lease_fencing_token >= 0),
  lease_expires_at timestamptz,
  sweep_started_at timestamptz,
  after_cursor text,
  page_count integer not null default 0 check (page_count >= 0),
  last_full_sweep_completed_at timestamptz,
  baseline_completed_at timestamptz,
  safe_result_code text,
  safe_failure_code text check (safe_failure_code is null or safe_failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  check (validation_id is null),
  check ((state = 'leased') = (lease_owner is not null and lease_expires_at is not null))
);

create table public.builder_newsletter_readiness_revisions (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  revision integer not null check (revision > 0),
  provider_scope_id text not null check (char_length(provider_scope_id) between 1 and 160),
  audience_count integer not null check (audience_count >= 0),
  eligibility_digest text not null check (eligibility_digest ~ '^[a-f0-9]{64}$'),
  reconciled_at timestamptz not null,
  expires_at timestamptz not null,
  state text not null check (state in ('ready', 'stale', 'blocked')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, revision),
  check (expires_at > reconciled_at)
);

create table public.builder_newsletter_webhook_receipts (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  provider_scope_id text not null check (char_length(provider_scope_id) between 1 and 160),
  svix_id text not null check (char_length(svix_id) between 1 and 200),
  event_type text not null check (char_length(event_type) between 1 and 100),
  provider_created_at timestamptz not null,
  provider_message_id text,
  provider_broadcast_id text,
  disposition text not null check (disposition in ('ignored', 'matched', 'incident')),
  safe_digest text not null check (safe_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, provider_scope_id, svix_id)
);

create table public.builder_newsletter_staff_test_windows (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  command_id uuid not null,
  operator_id uuid not null,
  provider_broadcast_id text not null,
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  allowlist_revision text not null,
  recipient_fingerprint text not null check (recipient_fingerprint ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null default (clock_timestamp() + interval '30 minutes'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, command_id)
);

create table public.builder_newsletter_staff_test_observations (
  site_id uuid not null,
  id uuid not null default extensions.gen_random_uuid(),
  window_id uuid not null,
  provider_message_id text not null,
  provider_broadcast_id text not null,
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  recipient_fingerprint text not null check (recipient_fingerprint ~ '^[a-f0-9]{64}$'),
  provider_status text not null,
  state text not null check (state in ('provisional_test', 'confirmed_test', 'rejected')),
  recheck_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, provider_message_id),
  foreign key (site_id, window_id)
    references public.builder_newsletter_staff_test_windows(site_id, id) on delete cascade
);

create table public.builder_newsletter_broadcast_validations (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  command_id uuid not null,
  operator_id uuid not null,
  provider_broadcast_id text not null,
  confirmed_test_observation_id uuid not null,
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  segment_id text not null,
  topic_id text not null,
  sender text not null,
  reply_to_state text not null,
  readiness_revision_id uuid not null,
  audience_count integer not null check (audience_count >= 0),
  state text not null default 'valid' check (state in ('valid', 'consumed_matching', 'expired', 'revoked')),
  validated_at timestamptz not null default clock_timestamp(),
  valid_until timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, command_id),
  foreign key (site_id, confirmed_test_observation_id)
    references public.builder_newsletter_staff_test_observations(site_id, id) on delete restrict,
  foreign key (site_id, readiness_revision_id)
    references public.builder_newsletter_readiness_revisions(site_id, id) on delete restrict,
  check (valid_until = validated_at + interval '10 minutes')
);

create table public.builder_newsletter_broadcast_incidents (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  provider_scope_id text not null,
  provider_broadcast_id text not null,
  reason text not null check (reason in ('unvalidated', 'mismatch', 'expired', 'provider_anomaly')),
  state text not null default 'open' check (state in ('open', 'contained', 'resolved')),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_evidence_id text not null,
  last_evidence_id text not null,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  primary_operator_id uuid,
  secondary_operator_id uuid,
  readiness_revision_id uuid,
  resolution_reason text,
  resolved_at timestamptz,
  primary key (site_id, id),
  unique (site_id, provider_scope_id, provider_broadcast_id)
);

create index builder_newsletter_jobs_claim_idx
  on public.builder_newsletter_jobs (site_id, state, available_at, created_at);
create index builder_newsletter_site_jobs_claim_idx
  on public.builder_newsletter_site_jobs (site_id, state, available_at, created_at);
create index builder_newsletter_broadcast_jobs_claim_idx
  on public.builder_newsletter_broadcast_audit_jobs (site_id, state, available_at, created_at);

alter table public.builder_newsletter_subscriptions enable row level security;
alter table public.builder_newsletter_confirmation_generations enable row level security;
alter table builder_private.builder_newsletter_delivery_ledger enable row level security;
alter table builder_private.builder_newsletter_confirmation_sessions enable row level security;
alter table public.builder_newsletter_jobs enable row level security;
alter table public.builder_newsletter_site_jobs enable row level security;
alter table public.builder_newsletter_broadcast_audit_jobs enable row level security;
alter table public.builder_newsletter_readiness_revisions enable row level security;
alter table public.builder_newsletter_webhook_receipts enable row level security;
alter table public.builder_newsletter_staff_test_windows enable row level security;
alter table public.builder_newsletter_staff_test_observations enable row level security;
alter table public.builder_newsletter_broadcast_validations enable row level security;
alter table public.builder_newsletter_broadcast_incidents enable row level security;

revoke all on table
  public.builder_newsletter_subscriptions,
  public.builder_newsletter_confirmation_generations,
  builder_private.builder_newsletter_delivery_ledger,
  builder_private.builder_newsletter_confirmation_sessions,
  public.builder_newsletter_jobs,
  public.builder_newsletter_site_jobs,
  public.builder_newsletter_broadcast_audit_jobs,
  public.builder_newsletter_readiness_revisions,
  public.builder_newsletter_webhook_receipts,
  public.builder_newsletter_staff_test_windows,
  public.builder_newsletter_staff_test_observations,
  public.builder_newsletter_broadcast_validations,
  public.builder_newsletter_broadcast_incidents
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.builder_newsletter_subscriptions,
  public.builder_newsletter_confirmation_generations,
  builder_private.builder_newsletter_delivery_ledger,
  builder_private.builder_newsletter_confirmation_sessions,
  public.builder_newsletter_jobs,
  public.builder_newsletter_site_jobs,
  public.builder_newsletter_broadcast_audit_jobs,
  public.builder_newsletter_readiness_revisions,
  public.builder_newsletter_webhook_receipts,
  public.builder_newsletter_staff_test_windows,
  public.builder_newsletter_staff_test_observations,
  public.builder_newsletter_broadcast_validations,
  public.builder_newsletter_broadcast_incidents
to service_role;

create function public.builder_ingest_official_assembly_newsletter_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ingestion jsonb;
  v_base jsonb;
  v_site_id uuid;
  v_receipt_id uuid;
  v_submission_id uuid;
  v_contact_id uuid;
  v_consent_id uuid;
  v_subscription public.builder_newsletter_subscriptions%rowtype;
  v_generation public.builder_newsletter_confirmation_generations%rowtype;
  v_delivery builder_private.builder_newsletter_delivery_ledger%rowtype;
  v_address_fingerprint text;
  v_key_id text;
  v_delivery_ordinal integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_request is null
    or (p_request ->> 'version') <> '1'
    or jsonb_typeof(p_request -> 'ingestion') <> 'object'
  then
    raise exception 'invalid newsletter request' using errcode = '22023';
  end if;

  v_ingestion := p_request -> 'ingestion';
  begin
    v_site_id := (v_ingestion ->> 'siteId')::uuid;
  exception when others then
    raise exception 'invalid newsletter request' using errcode = '22023';
  end;
  v_address_fingerprint := p_request ->> 'addressFingerprint';
  v_key_id := p_request ->> 'confirmationKeyId';
  if v_address_fingerprint is null or v_address_fingerprint !~ '^[a-f0-9]{64}$'
    or v_key_id is null or v_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  then
    raise exception 'invalid newsletter request' using errcode = '22023';
  end if;

  -- The strict form transaction and newsletter transaction are one unit.
  v_base := public.builder_ingest_form_submission_strict_v3(v_ingestion);
  v_receipt_id := (v_base ->> 'receiptId')::uuid;
  v_submission_id := (v_base ->> 'submissionId')::uuid;

  if pg_catalog.current_setting('builder.newsletter_test_failure', true) = 'after_strict_ingestion' then
    raise exception 'newsletter injected rollback' using errcode = 'P2N99';
  end if;

  select ledger.* into v_delivery
  from builder_private.builder_newsletter_delivery_ledger ledger
  where ledger.site_id = v_site_id and ledger.source_receipt_id = v_receipt_id;
  if found then
    if v_delivery.address_fingerprint <> v_address_fingerprint then
      raise exception 'newsletter receipt is incompatible' using errcode = 'P2N01';
    end if;
    return jsonb_build_object(
      'version', 2,
      'accepted', true,
      'receiptId', v_receipt_id,
      'result', 'replayed',
      'subscriptionId', v_delivery.subscription_id,
      'confirmationGeneration', v_delivery.confirmation_generation,
      'deliveryOrdinal', v_delivery.delivery_ordinal,
      'deliveryQueued', true
    );
  end if;

  select result.contact_id into v_contact_id
  from public.builder_form_submission_results result
  where result.site_id = v_site_id and result.submission_id = v_submission_id
  order by result.version desc
  limit 1;
  if v_contact_id is null then
    raise exception 'newsletter contact is unavailable' using errcode = 'P2N02';
  end if;

  select consent.id into v_consent_id
  from public.builder_consents consent
  join public.builder_form_submission_consents base_consent
    on base_consent.site_id = consent.site_id and base_consent.id = consent.base_consent_id
  where consent.site_id = v_site_id
    and consent.contact_id = v_contact_id
    and consent.purpose = 'marketing_email'
    and consent.channel = 'email'
    and consent.state = 'granted'
    and base_consent.submission_id = v_submission_id
  order by consent.created_at desc
  limit 1;
  if v_consent_id is null then
    raise exception 'newsletter consent is unavailable' using errcode = 'P2N02';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_site_id::text || ':newsletter:' || v_contact_id::text, 0)
  );
  select subscription.* into v_subscription
  from public.builder_newsletter_subscriptions subscription
  where subscription.site_id = v_site_id and subscription.contact_id = v_contact_id
  for update;

  if not found then
    insert into public.builder_newsletter_subscriptions (
      site_id, contact_id, current_consent_id, status, current_generation
    ) values (
      v_site_id, v_contact_id, v_consent_id, 'pending_confirmation', 1
    ) returning * into v_subscription;
  else
    update public.builder_newsletter_subscriptions
    set current_consent_id = v_consent_id, updated_at = v_now, version = version + 1
    where site_id = v_subscription.site_id and id = v_subscription.id
    returning * into v_subscription;
  end if;

  select generation.* into v_generation
  from public.builder_newsletter_confirmation_generations generation
  where generation.site_id = v_site_id
    and generation.subscription_id = v_subscription.id
    and generation.generation = v_subscription.current_generation
  for update;

  if not found or v_generation.consumed_at is not null or v_generation.expires_at <= v_now then
    if found then
      v_subscription.current_generation := v_subscription.current_generation + 1;
      update public.builder_newsletter_subscriptions
      set current_generation = v_subscription.current_generation,
          status = 'pending_confirmation',
          updated_at = v_now,
          version = version + 1
      where site_id = v_site_id and id = v_subscription.id;
    end if;
    insert into public.builder_newsletter_confirmation_generations (
      site_id, subscription_id, generation, nonce, signing_key_id, issued_at, expires_at
    ) values (
      v_site_id,
      v_subscription.id,
      v_subscription.current_generation,
      encode(extensions.gen_random_bytes(32), 'hex'),
      v_key_id,
      v_now,
      v_now + interval '48 hours'
    ) returning * into v_generation;
  end if;

  select max(ledger.delivery_ordinal) into v_delivery_ordinal
  from builder_private.builder_newsletter_delivery_ledger ledger
  where ledger.site_id = v_site_id
    and ledger.subscription_id = v_subscription.id
    and ledger.confirmation_generation = v_generation.generation;

  -- Different receipts inside the cooldown remain generically accepted but do
  -- not consume another logical send allowance.
  if coalesce(v_delivery_ordinal, 0) > 0 and exists (
    select 1
    from builder_private.builder_newsletter_delivery_ledger ledger
    where ledger.site_id = v_site_id
      and ledger.subscription_id = v_subscription.id
      and ledger.created_at > v_now - interval '15 minutes'
  ) then
    return jsonb_build_object(
      'version', 2,
      'accepted', true,
      'receiptId', v_receipt_id,
      'result', v_base ->> 'result',
      'subscriptionId', v_subscription.id,
      'confirmationGeneration', v_generation.generation,
      'deliveryOrdinal', v_delivery_ordinal,
      'deliveryQueued', false
    );
  end if;

  v_delivery_ordinal := coalesce(v_delivery_ordinal, 0) + 1;
  insert into builder_private.builder_newsletter_delivery_ledger (
    site_id, subscription_id, confirmation_generation, delivery_ordinal,
    source_receipt_id, address_fingerprint, created_at
  ) values (
    v_site_id, v_subscription.id, v_generation.generation, v_delivery_ordinal,
    v_receipt_id, v_address_fingerprint, v_now
  );

  insert into public.builder_newsletter_jobs (
    site_id, subscription_id, kind, confirmation_generation,
    delivery_ordinal, idempotency_key
  ) values (
    v_site_id,
    v_subscription.id,
    'newsletter.confirmation.send',
    v_generation.generation,
    v_delivery_ordinal,
    'newsletter-confirmation/' || v_site_id || '/' || v_subscription.id || '/' ||
      v_generation.generation || '/' || v_delivery_ordinal
  );

  return jsonb_build_object(
    'version', 2,
    'accepted', true,
    'receiptId', v_receipt_id,
    'result', v_base ->> 'result',
    'subscriptionId', v_subscription.id,
    'confirmationGeneration', v_generation.generation,
    'deliveryOrdinal', v_delivery_ordinal,
    'deliveryQueued', true
  );
end;
$$;

create function public.builder_exchange_newsletter_confirmation_session_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_subscription_id uuid;
  v_generation integer;
  v_session_id uuid;
  v_expires_at timestamptz;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_subscription_id := (p_request ->> 'subscriptionId')::uuid;
    v_generation := (p_request ->> 'generation')::integer;
    v_expires_at := (p_request ->> 'sessionExpiresAt')::timestamptz;
  exception when others then
    raise exception 'invalid confirmation exchange' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1'
    or (p_request ->> 'sessionDigest') !~ '^[a-f0-9]{64}$'
    or v_expires_at <= clock_timestamp()
    or v_expires_at > clock_timestamp() + interval '15 minutes'
    or not exists (
      select 1
      from public.builder_newsletter_confirmation_generations generation
      where generation.site_id = v_site_id
        and generation.subscription_id = v_subscription_id
        and generation.generation = v_generation
        and generation.nonce = p_request ->> 'nonce'
        and generation.signing_key_id = p_request ->> 'keyId'
        and generation.consumed_at is null
        and generation.expires_at > clock_timestamp()
    )
  then
    raise exception 'confirmation token is invalid' using errcode = '22023';
  end if;

  insert into builder_private.builder_newsletter_confirmation_sessions (
    site_id, subscription_id, confirmation_generation, session_digest, expires_at
  ) values (
    v_site_id, v_subscription_id, v_generation, p_request ->> 'sessionDigest', v_expires_at
  )
  on conflict (site_id, session_digest) do update set session_digest = excluded.session_digest
  returning id into v_session_id;

  return jsonb_build_object('version', 1, 'status', 'ready', 'sessionId', v_session_id);
end;
$$;

create function public.builder_confirm_newsletter_subscription_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_session builder_private.builder_newsletter_confirmation_sessions%rowtype;
  v_subscription public.builder_newsletter_subscriptions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
  exception when others then
    raise exception 'invalid confirmation request' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1' or (p_request ->> 'sessionDigest') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid confirmation request' using errcode = '22023';
  end if;

  select session.* into v_session
  from builder_private.builder_newsletter_confirmation_sessions session
  where session.site_id = v_site_id and session.session_digest = p_request ->> 'sessionDigest'
  for update;
  if not found or v_session.expires_at <= v_now then
    raise exception 'confirmation session is invalid' using errcode = '22023';
  end if;

  select subscription.* into v_subscription
  from public.builder_newsletter_subscriptions subscription
  where subscription.site_id = v_site_id and subscription.id = v_session.subscription_id
  for update;
  if v_session.consumed_at is not null or v_subscription.status <> 'pending_confirmation' then
    return jsonb_build_object('version', 1, 'status', 'already_confirmed');
  end if;

  update builder_private.builder_newsletter_confirmation_sessions
  set consumed_at = v_now
  where site_id = v_site_id and id = v_session.id;
  update public.builder_newsletter_confirmation_generations
  set consumed_at = v_now
  where site_id = v_site_id
    and subscription_id = v_session.subscription_id
    and generation = v_session.confirmation_generation
    and consumed_at is null;
  update public.builder_newsletter_subscriptions
  set status = 'confirmed_pending_provider', confirmed_at = v_now,
      updated_at = v_now, version = version + 1
  where site_id = v_site_id and id = v_session.subscription_id;

  insert into public.builder_newsletter_jobs (
    site_id, subscription_id, kind, idempotency_key
  ) values (
    v_site_id,
    v_session.subscription_id,
    'newsletter.contact.sync',
    'newsletter-contact-sync/' || v_site_id || '/' || v_session.subscription_id || '/' || v_session.confirmation_generation
  ) on conflict (site_id, idempotency_key) do nothing;

  return jsonb_build_object('version', 1, 'status', 'confirmed_pending_provider');
end;
$$;

create function public.builder_claim_newsletter_jobs_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_worker_id uuid;
  v_limit integer;
  v_lease_seconds integer;
  v_email_enabled boolean;
  v_jobs jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_row record;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_worker_id := (p_request ->> 'workerId')::uuid;
    v_limit := (p_request ->> 'limit')::integer;
    v_lease_seconds := (p_request ->> 'leaseSeconds')::integer;
    v_email_enabled := (p_request ->> 'emailEnabled')::boolean;
  exception when others then
    raise exception 'invalid newsletter job claim' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1'
    or v_limit not between 1 and 100
    or v_lease_seconds not between 15 and 900
  then
    raise exception 'invalid newsletter job claim' using errcode = '22023';
  end if;

  if not v_email_enabled then
    for v_row in
      select job.id
      from public.builder_newsletter_site_jobs job
      where job.site_id = v_site_id
        and job.kind = 'newsletter.contact.audit'
        and job.state in ('queued', 'retryable_failed')
        and job.available_at <= clock_timestamp()
      order by job.created_at, job.id
      for update skip locked
      limit v_limit
    loop
      update public.builder_newsletter_site_jobs
      set state = 'leased', lease_owner = v_worker_id,
          lease_fencing_token = lease_fencing_token + 1,
          lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
          attempt_count = attempt_count + 1, updated_at = clock_timestamp()
      where site_id = v_site_id and id = v_row.id
      returning jsonb_build_object(
        'subject', 'site', 'id', id, 'kind', kind,
        'fencingToken', lease_fencing_token, 'leaseExpiresAt', lease_expires_at
      ) into v_row;
      v_jobs := v_jobs || jsonb_build_array(v_row.jsonb_build_object);
      v_count := v_count + 1;
    end loop;

    if v_count < v_limit then
      for v_row in
        select job.id
        from public.builder_newsletter_broadcast_audit_jobs job
        where job.site_id = v_site_id
          and job.state in ('queued', 'retryable_failed')
          and job.available_at <= clock_timestamp()
        order by job.created_at, job.id
        for update skip locked
        limit (v_limit - v_count)
      loop
        update public.builder_newsletter_broadcast_audit_jobs
        set state = 'leased', lease_owner = v_worker_id,
            lease_fencing_token = lease_fencing_token + 1,
            lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
            attempt_count = attempt_count + 1,
            sweep_started_at = coalesce(sweep_started_at, clock_timestamp()),
            updated_at = clock_timestamp()
        where site_id = v_site_id and id = v_row.id
        returning jsonb_build_object(
          'subject', 'broadcast', 'id', id, 'kind', kind,
          'fencingToken', lease_fencing_token, 'leaseExpiresAt', lease_expires_at,
          'afterCursor', after_cursor
        ) into v_row;
        v_jobs := v_jobs || jsonb_build_array(v_row.jsonb_build_object);
        v_count := v_count + 1;
      end loop;
    end if;
  else
    for v_row in
      select job.id
      from public.builder_newsletter_jobs job
      where job.site_id = v_site_id
        and job.state in ('queued', 'retryable_failed')
        and job.available_at <= clock_timestamp()
      order by job.created_at, job.id
      for update skip locked
      limit v_limit
    loop
      update public.builder_newsletter_jobs
      set state = 'leased', lease_owner = v_worker_id,
          lease_fencing_token = lease_fencing_token + 1,
          lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
          attempt_count = attempt_count + 1, updated_at = clock_timestamp()
      where site_id = v_site_id and id = v_row.id
      returning jsonb_build_object(
        'subject', 'subscription', 'id', id, 'kind', kind,
        'subscriptionId', subscription_id,
        'confirmationGeneration', confirmation_generation,
        'deliveryOrdinal', delivery_ordinal,
        'fencingToken', lease_fencing_token, 'leaseExpiresAt', lease_expires_at
      ) into v_row;
      v_jobs := v_jobs || jsonb_build_array(v_row.jsonb_build_object);
      v_count := v_count + 1;
    end loop;

    if v_count < v_limit then
      for v_row in
        select job.id
        from public.builder_newsletter_site_jobs job
        where job.site_id = v_site_id
          and job.kind = 'newsletter.segment.reconcile'
          and job.state in ('queued', 'retryable_failed')
          and job.available_at <= clock_timestamp()
        order by job.created_at, job.id
        for update skip locked
        limit (v_limit - v_count)
      loop
        update public.builder_newsletter_site_jobs
        set state = 'leased', lease_owner = v_worker_id,
            lease_fencing_token = lease_fencing_token + 1,
            lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
            attempt_count = attempt_count + 1, updated_at = clock_timestamp()
        where site_id = v_site_id and id = v_row.id
        returning jsonb_build_object(
          'subject', 'site', 'id', id, 'kind', kind,
          'fencingToken', lease_fencing_token, 'leaseExpiresAt', lease_expires_at
        ) into v_row;
        v_jobs := v_jobs || jsonb_build_array(v_row.jsonb_build_object);
        v_count := v_count + 1;
      end loop;
    end if;
  end if;

  return jsonb_build_object('version', 1, 'jobs', v_jobs);
end;
$$;

create function public.builder_complete_newsletter_job_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_job_id uuid;
  v_worker_id uuid;
  v_fencing bigint;
  v_changed integer;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_job_id := (p_request ->> 'jobId')::uuid;
    v_worker_id := (p_request ->> 'workerId')::uuid;
    v_fencing := (p_request ->> 'fencingToken')::bigint;
  exception when others then
    raise exception 'invalid newsletter job completion' using errcode = '22023';
  end;

  if p_request ->> 'subject' = 'subscription' then
    update public.builder_newsletter_jobs
    set state = 'completed', safe_result_code = left(p_request ->> 'resultCode', 64),
        lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_job_id and state = 'leased'
      and lease_owner = v_worker_id and lease_fencing_token = v_fencing
      and lease_expires_at > clock_timestamp();
  elsif p_request ->> 'subject' = 'site' then
    update public.builder_newsletter_site_jobs
    set state = 'completed', safe_result_code = left(p_request ->> 'resultCode', 64),
        lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_job_id and state = 'leased'
      and lease_owner = v_worker_id and lease_fencing_token = v_fencing
      and lease_expires_at > clock_timestamp();
  elsif p_request ->> 'subject' = 'broadcast' then
    update public.builder_newsletter_broadcast_audit_jobs
    set state = 'completed', safe_result_code = left(p_request ->> 'resultCode', 64),
        lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_job_id and state = 'leased'
      and lease_owner = v_worker_id and lease_fencing_token = v_fencing
      and lease_expires_at > clock_timestamp();
  else
    raise exception 'invalid newsletter job subject' using errcode = '22023';
  end if;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;
  return jsonb_build_object('version', 1, 'state', 'completed');
end;
$$;

create function public.builder_fail_newsletter_job_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_job_id uuid;
  v_worker_id uuid;
  v_fencing bigint;
  v_state text;
  v_available_at timestamptz;
  v_changed integer;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_job_id := (p_request ->> 'jobId')::uuid;
    v_worker_id := (p_request ->> 'workerId')::uuid;
    v_fencing := (p_request ->> 'fencingToken')::bigint;
    v_state := case when (p_request ->> 'terminal')::boolean then 'terminal_failed' else 'retryable_failed' end;
    v_available_at := case when v_state = 'retryable_failed' then (p_request ->> 'retryAt')::timestamptz else clock_timestamp() end;
  exception when others then
    raise exception 'invalid newsletter job failure' using errcode = '22023';
  end;
  if (p_request ->> 'failureCode') !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'invalid newsletter failure code' using errcode = '22023';
  end if;

  if p_request ->> 'subject' = 'subscription' then
    update public.builder_newsletter_jobs
    set state = v_state, available_at = v_available_at,
        safe_failure_code = p_request ->> 'failureCode',
        lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_job_id and state = 'leased'
      and lease_owner = v_worker_id and lease_fencing_token = v_fencing
      and lease_expires_at > clock_timestamp();
  elsif p_request ->> 'subject' = 'site' then
    update public.builder_newsletter_site_jobs
    set state = v_state, available_at = v_available_at,
        safe_failure_code = p_request ->> 'failureCode',
        lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_job_id and state = 'leased'
      and lease_owner = v_worker_id and lease_fencing_token = v_fencing
      and lease_expires_at > clock_timestamp();
  elsif p_request ->> 'subject' = 'broadcast' then
    update public.builder_newsletter_broadcast_audit_jobs
    set state = v_state, available_at = v_available_at,
        safe_failure_code = p_request ->> 'failureCode',
        lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_job_id and state = 'leased'
      and lease_owner = v_worker_id and lease_fencing_token = v_fencing
      and lease_expires_at > clock_timestamp();
  else
    raise exception 'invalid newsletter job subject' using errcode = '22023';
  end if;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;
  return jsonb_build_object('version', 1, 'state', v_state);
end;
$$;

create function public.builder_reconcile_newsletter_webhook_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_receipt_id uuid;
  v_existing public.builder_newsletter_webhook_receipts%rowtype;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
  exception when others then
    raise exception 'invalid newsletter webhook' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1'
    or nullif(p_request ->> 'providerScopeId', '') is null
    or nullif(p_request ->> 'svixId', '') is null
    or (p_request ->> 'digest') !~ '^[a-f0-9]{64}$'
    or (p_request ->> 'disposition') not in ('ignored', 'matched', 'incident')
  then
    raise exception 'invalid newsletter webhook' using errcode = '22023';
  end if;

  select receipt.* into v_existing
  from public.builder_newsletter_webhook_receipts receipt
  where receipt.site_id = v_site_id
    and receipt.provider_scope_id = p_request ->> 'providerScopeId'
    and receipt.svix_id = p_request ->> 'svixId';
  if found then
    return jsonb_build_object(
      'version', 1, 'replayed', true, 'disposition', v_existing.disposition,
      'receiptId', v_existing.id
    );
  end if;

  insert into public.builder_newsletter_webhook_receipts (
    site_id, provider_scope_id, svix_id, event_type, provider_created_at,
    provider_message_id, provider_broadcast_id, disposition, safe_digest
  ) values (
    v_site_id,
    p_request ->> 'providerScopeId',
    p_request ->> 'svixId',
    p_request ->> 'eventType',
    (p_request ->> 'providerCreatedAt')::timestamptz,
    nullif(p_request ->> 'providerMessageId', ''),
    nullif(p_request ->> 'providerBroadcastId', ''),
    p_request ->> 'disposition',
    p_request ->> 'digest'
  ) returning id into v_receipt_id;

  if pg_catalog.current_setting('builder.newsletter_test_failure', true) = 'after_webhook_receipt' then
    raise exception 'newsletter injected rollback' using errcode = 'P2N99';
  end if;

  if p_request ->> 'disposition' = 'incident' then
    if nullif(p_request ->> 'providerBroadcastId', '') is null
      or (p_request ->> 'incidentReason') not in ('unvalidated', 'mismatch', 'expired', 'provider_anomaly')
    then
      raise exception 'invalid newsletter incident' using errcode = '22023';
    end if;
    insert into public.builder_newsletter_broadcast_incidents (
      site_id, provider_scope_id, provider_broadcast_id, reason,
      first_evidence_id, last_evidence_id
    ) values (
      v_site_id,
      p_request ->> 'providerScopeId',
      p_request ->> 'providerBroadcastId',
      p_request ->> 'incidentReason',
      p_request ->> 'svixId',
      p_request ->> 'svixId'
    )
    on conflict (site_id, provider_scope_id, provider_broadcast_id) do update
    set occurrence_count = public.builder_newsletter_broadcast_incidents.occurrence_count + 1,
        last_evidence_id = excluded.last_evidence_id,
        last_seen_at = clock_timestamp();
  end if;

  return jsonb_build_object(
    'version', 1, 'replayed', false,
    'disposition', p_request ->> 'disposition', 'receiptId', v_receipt_id
  );
end;
$$;

create function public.builder_open_newsletter_staff_test_window_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_id uuid;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
  exception when others then
    raise exception 'invalid staff test window' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1'
    or (p_request ->> 'digest') !~ '^[a-f0-9]{64}$'
    or (p_request ->> 'recipientFingerprint') !~ '^[a-f0-9]{64}$'
  then
    raise exception 'invalid staff test window' using errcode = '22023';
  end if;
  insert into public.builder_newsletter_staff_test_windows (
    site_id, command_id, operator_id, provider_broadcast_id, digest,
    allowlist_revision, recipient_fingerprint
  ) values (
    v_site_id,
    (p_request ->> 'commandId')::uuid,
    (p_request ->> 'operatorId')::uuid,
    p_request ->> 'providerBroadcastId',
    p_request ->> 'digest',
    p_request ->> 'allowlistRevision',
    p_request ->> 'recipientFingerprint'
  )
  on conflict (site_id, command_id) do update set command_id = excluded.command_id
  returning id into v_id;
  return jsonb_build_object('version', 1, 'state', 'open', 'windowId', v_id);
end;
$$;

create function public.builder_record_newsletter_staff_test_observation_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_observation public.builder_newsletter_staff_test_observations%rowtype;
  v_window public.builder_newsletter_staff_test_windows%rowtype;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
  exception when others then
    raise exception 'invalid staff test observation' using errcode = '22023';
  end;

  if coalesce(p_request ->> 'action', 'observe') = 'confirm' then
    select observation.* into v_observation
    from public.builder_newsletter_staff_test_observations observation
    where observation.site_id = v_site_id
      and observation.id = (p_request ->> 'observationId')::uuid
    for update;
    if not found
      or v_observation.state <> 'provisional_test'
      or v_observation.recheck_at > clock_timestamp()
      or v_observation.provider_message_id <> p_request ->> 'providerMessageId'
      or v_observation.provider_broadcast_id <> p_request ->> 'providerBroadcastId'
      or v_observation.digest <> p_request ->> 'digest'
      or p_request ->> 'providerStatus' <> 'draft'
    then
      raise exception 'staff test observation cannot be confirmed' using errcode = '22023';
    end if;
    update public.builder_newsletter_staff_test_observations
    set state = 'confirmed_test', confirmed_at = clock_timestamp(), updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_observation.id;
    return jsonb_build_object('version', 1, 'state', 'confirmed_test', 'observationId', v_observation.id);
  end if;

  select test_window.* into v_window
  from public.builder_newsletter_staff_test_windows test_window
  where test_window.site_id = v_site_id and test_window.id = (p_request ->> 'windowId')::uuid;
  if not found
    or v_window.expires_at <= clock_timestamp()
    or v_window.provider_broadcast_id <> p_request ->> 'providerBroadcastId'
    or v_window.digest <> p_request ->> 'digest'
    or v_window.recipient_fingerprint <> p_request ->> 'recipientFingerprint'
    or p_request ->> 'providerStatus' <> 'draft'
  then
    raise exception 'staff test observation is invalid' using errcode = '22023';
  end if;

  insert into public.builder_newsletter_staff_test_observations (
    site_id, window_id, provider_message_id, provider_broadcast_id,
    digest, recipient_fingerprint, provider_status, state, recheck_at
  ) values (
    v_site_id,
    v_window.id,
    p_request ->> 'providerMessageId',
    p_request ->> 'providerBroadcastId',
    p_request ->> 'digest',
    p_request ->> 'recipientFingerprint',
    p_request ->> 'providerStatus',
    'provisional_test',
    clock_timestamp() + interval '15 minutes'
  ) returning * into v_observation;
  return jsonb_build_object('version', 1, 'state', 'provisional_test', 'observationId', v_observation.id);
end;
$$;

create function public.builder_create_newsletter_broadcast_validation_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_id uuid;
  v_validated_at timestamptz := clock_timestamp();
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
  exception when others then
    raise exception 'invalid broadcast validation' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1'
    or not exists (
      select 1
      from public.builder_newsletter_staff_test_observations observation
      where observation.site_id = v_site_id
        and observation.id = (p_request ->> 'confirmedTestObservationId')::uuid
        and observation.state = 'confirmed_test'
        and observation.provider_broadcast_id = p_request ->> 'providerBroadcastId'
        and observation.digest = p_request ->> 'digest'
    )
    or not exists (
      select 1
      from public.builder_newsletter_readiness_revisions readiness
      where readiness.site_id = v_site_id
        and readiness.id = (p_request ->> 'readinessRevisionId')::uuid
        and readiness.state = 'ready'
        and readiness.expires_at > v_validated_at
        and readiness.audience_count = (p_request ->> 'audienceCount')::integer
    )
  then
    raise exception 'broadcast validation prerequisites are not met' using errcode = '22023';
  end if;

  insert into public.builder_newsletter_broadcast_validations (
    site_id, command_id, operator_id, provider_broadcast_id,
    confirmed_test_observation_id, digest, segment_id, topic_id, sender,
    reply_to_state, readiness_revision_id, audience_count,
    validated_at, valid_until
  ) values (
    v_site_id,
    (p_request ->> 'commandId')::uuid,
    (p_request ->> 'operatorId')::uuid,
    p_request ->> 'providerBroadcastId',
    (p_request ->> 'confirmedTestObservationId')::uuid,
    p_request ->> 'digest',
    p_request ->> 'segmentId',
    p_request ->> 'topicId',
    p_request ->> 'sender',
    p_request ->> 'replyToState',
    (p_request ->> 'readinessRevisionId')::uuid,
    (p_request ->> 'audienceCount')::integer,
    v_validated_at,
    v_validated_at + interval '10 minutes'
  )
  on conflict (site_id, command_id) do update set command_id = excluded.command_id
  returning id into v_id;
  return jsonb_build_object('version', 1, 'state', 'valid', 'validationId', v_id);
end;
$$;

create function public.builder_classify_newsletter_broadcast_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_sent_at timestamptz;
  v_validation public.builder_newsletter_broadcast_validations%rowtype;
  v_incident_id uuid;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_sent_at := (p_request ->> 'sentAt')::timestamptz;
  exception when others then
    raise exception 'invalid broadcast evidence' using errcode = '22023';
  end;
  if nullif(p_request ->> 'validationId', '') is not null then
    select validation.* into v_validation
    from public.builder_newsletter_broadcast_validations validation
    where validation.site_id = v_site_id
      and validation.id = (p_request ->> 'validationId')::uuid
    for update;
  end if;

  if found
    and v_validation.state = 'valid'
    and v_validation.provider_broadcast_id = p_request ->> 'providerBroadcastId'
    and v_validation.digest = p_request ->> 'digest'
    and p_request ->> 'providerStatus' = 'sent'
    and v_sent_at >= v_validation.validated_at
    and v_sent_at < v_validation.valid_until
  then
    update public.builder_newsletter_broadcast_validations
    set state = 'consumed_matching', consumed_at = clock_timestamp()
    where site_id = v_site_id and id = v_validation.id and state = 'valid';
    return jsonb_build_object(
      'version', 1, 'disposition', 'consumed_matching', 'validationId', v_validation.id
    );
  end if;

  insert into public.builder_newsletter_broadcast_incidents (
    site_id, provider_scope_id, provider_broadcast_id, reason,
    first_evidence_id, last_evidence_id
  ) values (
    v_site_id,
    p_request ->> 'providerScopeId',
    p_request ->> 'providerBroadcastId',
    case
      when v_validation.id is null then 'unvalidated'
      when v_sent_at >= v_validation.valid_until then 'expired'
      else 'mismatch'
    end,
    p_request ->> 'evidenceId',
    p_request ->> 'evidenceId'
  )
  on conflict (site_id, provider_scope_id, provider_broadcast_id) do update
  set occurrence_count = public.builder_newsletter_broadcast_incidents.occurrence_count + 1,
      last_evidence_id = excluded.last_evidence_id,
      last_seen_at = clock_timestamp()
  returning id into v_incident_id;
  return jsonb_build_object('version', 1, 'disposition', 'incident', 'incidentId', v_incident_id);
end;
$$;

create function public.builder_record_newsletter_broadcast_audit_page_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_job_id uuid;
  v_worker_id uuid;
  v_fencing bigint;
  v_has_more boolean;
  v_changed integer;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_job_id := (p_request ->> 'jobId')::uuid;
    v_worker_id := (p_request ->> 'workerId')::uuid;
    v_fencing := (p_request ->> 'fencingToken')::bigint;
    v_has_more := (p_request ->> 'hasMore')::boolean;
  exception when others then
    raise exception 'invalid broadcast audit page' using errcode = '22023';
  end;
  if v_has_more and nullif(p_request ->> 'afterCursor', '') is null then
    raise exception 'a resumable audit cursor is required' using errcode = '22023';
  end if;

  update public.builder_newsletter_broadcast_audit_jobs
  set after_cursor = case when v_has_more then p_request ->> 'afterCursor' else null end,
      page_count = (p_request ->> 'pageCount')::integer,
      state = case when v_has_more then 'leased' else 'completed' end,
      last_full_sweep_completed_at = case when v_has_more then last_full_sweep_completed_at else clock_timestamp() end,
      baseline_completed_at = case when v_has_more then baseline_completed_at else coalesce(baseline_completed_at, clock_timestamp()) end,
      lease_owner = case when v_has_more then lease_owner else null end,
      lease_expires_at = case when v_has_more then lease_expires_at else null end,
      updated_at = clock_timestamp()
  where site_id = v_site_id and id = v_job_id and state = 'leased'
    and lease_owner = v_worker_id and lease_fencing_token = v_fencing
    and lease_expires_at > clock_timestamp();
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;
  return jsonb_build_object('version', 1, 'complete', not v_has_more);
end;
$$;

create function public.builder_resolve_newsletter_broadcast_incident_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_incident_id uuid;
  v_primary uuid;
  v_secondary uuid;
  v_changed integer;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_incident_id := (p_request ->> 'incidentId')::uuid;
    v_primary := (p_request ->> 'primaryOperatorId')::uuid;
    v_secondary := (p_request ->> 'secondaryOperatorId')::uuid;
  exception when others then
    raise exception 'invalid incident resolution' using errcode = '22023';
  end;
  if v_primary = v_secondary then
    raise exception 'two distinct operators are required' using errcode = '42501';
  end if;
  if not coalesce((p_request ->> 'featureDisabled')::boolean, false)
    or not coalesce((p_request ->> 'schedulesCleared')::boolean, false)
    or not coalesce((p_request ->> 'providerAccessRestricted')::boolean, false)
    or not coalesce((p_request ->> 'keysRotated')::boolean, false)
    or not coalesce((p_request ->> 'fullAuditCompleted')::boolean, false)
  then
    raise exception 'incident containment is incomplete' using errcode = '42501';
  end if;

  update public.builder_newsletter_broadcast_incidents
  set state = 'resolved', primary_operator_id = v_primary,
      secondary_operator_id = v_secondary,
      readiness_revision_id = (p_request ->> 'readinessRevisionId')::uuid,
      resolution_reason = left(p_request ->> 'resolutionReason', 200),
      resolved_at = clock_timestamp()
  where site_id = v_site_id and id = v_incident_id and state <> 'resolved';
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'incident is unavailable' using errcode = '55000';
  end if;
  return jsonb_build_object('version', 1, 'state', 'resolved', 'incidentId', v_incident_id);
end;
$$;

create function public.builder_get_newsletter_public_readiness_v1(p_site_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'ready', coalesce((
      select readiness.state = 'ready' and readiness.expires_at > clock_timestamp()
      from public.builder_newsletter_readiness_revisions readiness
      where readiness.site_id = p_site_id
      order by readiness.revision desc
      limit 1
    ), false)
  );
$$;

create function public.builder_get_newsletter_operations_status_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
  exception when others then
    raise exception 'invalid newsletter operations request' using errcode = '22023';
  end;
  return jsonb_build_object(
    'version', 1,
    'queuedJobs', (
      select count(*) from public.builder_newsletter_jobs job
      where job.site_id = v_site_id and job.state in ('queued', 'retryable_failed')
    ),
    'openIncidents', (
      select count(*) from public.builder_newsletter_broadcast_incidents incident
      where incident.site_id = v_site_id and incident.state <> 'resolved'
    )
  );
end;
$$;

revoke all on function
  public.builder_ingest_official_assembly_newsletter_v1(jsonb),
  public.builder_exchange_newsletter_confirmation_session_v1(jsonb),
  public.builder_confirm_newsletter_subscription_v1(jsonb),
  public.builder_claim_newsletter_jobs_v1(jsonb),
  public.builder_complete_newsletter_job_v1(jsonb),
  public.builder_fail_newsletter_job_v1(jsonb),
  public.builder_reconcile_newsletter_webhook_v1(jsonb),
  public.builder_open_newsletter_staff_test_window_v1(jsonb),
  public.builder_record_newsletter_staff_test_observation_v1(jsonb),
  public.builder_create_newsletter_broadcast_validation_v1(jsonb),
  public.builder_classify_newsletter_broadcast_v1(jsonb),
  public.builder_record_newsletter_broadcast_audit_page_v1(jsonb),
  public.builder_resolve_newsletter_broadcast_incident_v1(jsonb),
  public.builder_get_newsletter_public_readiness_v1(uuid),
  public.builder_get_newsletter_operations_status_v1(jsonb)
from public, anon, authenticated;

grant execute on function
  public.builder_ingest_official_assembly_newsletter_v1(jsonb),
  public.builder_exchange_newsletter_confirmation_session_v1(jsonb),
  public.builder_confirm_newsletter_subscription_v1(jsonb),
  public.builder_claim_newsletter_jobs_v1(jsonb),
  public.builder_complete_newsletter_job_v1(jsonb),
  public.builder_fail_newsletter_job_v1(jsonb),
  public.builder_reconcile_newsletter_webhook_v1(jsonb),
  public.builder_open_newsletter_staff_test_window_v1(jsonb),
  public.builder_record_newsletter_staff_test_observation_v1(jsonb),
  public.builder_create_newsletter_broadcast_validation_v1(jsonb),
  public.builder_classify_newsletter_broadcast_v1(jsonb),
  public.builder_record_newsletter_broadcast_audit_page_v1(jsonb),
  public.builder_resolve_newsletter_broadcast_incident_v1(jsonb),
  public.builder_get_newsletter_public_readiness_v1(uuid),
  public.builder_get_newsletter_operations_status_v1(jsonb)
to service_role;

-- Bring the pre-existing reviewed-consent import onto the same immutable
-- resolution rule as the new newsletter service surface.
do $$
begin
  if to_regprocedure('public.builder_import_newsletter_consent_v1(jsonb)') is not null then
    alter function public.builder_import_newsletter_consent_v1(jsonb)
      set search_path = '';
  end if;
end;
$$;
