alter table public.builder_newsletter_jobs
  add column provider_message_id text,
  add column first_attempt_at timestamptz,
  add column ambiguous_since timestamptz,
  add column saga_phase text;

alter table public.builder_newsletter_jobs
  add constraint builder_newsletter_jobs_provider_message_id_shape
    check (provider_message_id is null or char_length(provider_message_id) between 1 and 200),
  add constraint builder_newsletter_jobs_saga_phase_shape
    check (saga_phase is null or saga_phase in (
      'lookup', 'contact_ensured', 'topic_ensured', 'segment_ensured', 'verified'
    )),
  add constraint builder_newsletter_jobs_ambiguity_shape
    check (ambiguous_since is null or first_attempt_at is not null);
