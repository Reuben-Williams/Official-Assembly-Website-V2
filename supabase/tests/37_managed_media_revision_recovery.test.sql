begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '37100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'media-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.builder_sites (id, site_key, display_name) values
  ('37000000-0000-4000-8000-000000000001', 'managed-media-recovery', 'Managed media recovery');
insert into public.builder_site_members (site_id, user_id, role) values
  ('37000000-0000-4000-8000-000000000001', '37100000-0000-4000-8000-000000000001', 'owner');
insert into public.builder_content_types (site_id, key) values
  ('37000000-0000-4000-8000-000000000001', 'post');

insert into public.builder_media_assets (site_id, id, label, alt_text, created_by) values
  ('37000000-0000-4000-8000-000000000001', '37200000-0000-4000-8000-000000000001', 'Ready image', 'Residents at a town hall', '37100000-0000-4000-8000-000000000001'),
  ('37000000-0000-4000-8000-000000000001', '37200000-0000-4000-8000-000000000002', 'Pending image', 'Residents in the district', '37100000-0000-4000-8000-000000000001');
insert into public.builder_media_identities
  (site_id, sha256, media_id, byte_size, mime_type, width, height, created_by)
values
  ('37000000-0000-4000-8000-000000000001', repeat('a', 64), '37200000-0000-4000-8000-000000000001', 12, 'image/webp', 1, 1, '37100000-0000-4000-8000-000000000001'),
  ('37000000-0000-4000-8000-000000000001', repeat('b', 64), '37200000-0000-4000-8000-000000000002', 13, 'image/webp', 1, 1, '37100000-0000-4000-8000-000000000001');
insert into public.builder_media_revisions
  (site_id, media_id, id, object_key, mime_type, byte_size, width, height, created_by, sha256)
values
  ('37000000-0000-4000-8000-000000000001', '37200000-0000-4000-8000-000000000001', '37300000-0000-4000-8000-000000000001', 'managed-media-recovery/ready.webp', 'image/webp', 12, 1, 1, '37100000-0000-4000-8000-000000000001', repeat('a', 64)),
  ('37000000-0000-4000-8000-000000000001', '37200000-0000-4000-8000-000000000002', '37300000-0000-4000-8000-000000000002', 'managed-media-recovery/pending.webp', 'image/webp', 13, 1, 1, '37100000-0000-4000-8000-000000000001', repeat('b', 64));

select is(
  (select count(*)::integer from public.builder_media_recovery_replicas
   where site_id = '37000000-0000-4000-8000-000000000001' and status = 'pending'),
  2,
  'every immutable media revision is queued for recovery replication'
);

set local role service_role;
select is(
  (select claimed.revision_id::text from public.builder_claim_media_recovery_replica_v1('media-worker-test', 60, now()) claimed),
  '37300000-0000-4000-8000-000000000001',
  'the media worker claims the oldest due revision with a lease'
);
select ok(
  public.builder_complete_media_recovery_replica_v1(
    '37000000-0000-4000-8000-000000000001',
    '37200000-0000-4000-8000-000000000001',
    '37300000-0000-4000-8000-000000000001',
    'media-worker-test', 1, repeat('a', 64), 12, 'image/webp',
    'recovery/v1/preview/managed-media-recovery/media/ready.webp', now()
  ),
  'only a matching digest and fence can mark the replica ready'
);
reset role;

insert into public.builder_entries
  (site_id, id, content_type, status, created_by, updated_by)
values (
  '37000000-0000-4000-8000-000000000001',
  '37400000-0000-4000-8000-000000000001',
  'post', 'draft',
  '37100000-0000-4000-8000-000000000001',
  '37100000-0000-4000-8000-000000000001'
);
insert into public.builder_entry_versions
  (site_id, entry_id, id, version_kind, slug, snapshot, display_date, created_by)
values (
  '37000000-0000-4000-8000-000000000001',
  '37400000-0000-4000-8000-000000000001',
  '37500000-0000-4000-8000-000000000001',
  'published', 'district-update',
  jsonb_build_object(
    'slug', 'district-update',
    'data', jsonb_build_object(
      'title', 'District update',
      'excerpt', 'Latest district news.',
      'body', '{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"News from the district."}]}]}'::jsonb,
      'featuredImage', jsonb_build_object(
        'kind', 'managed',
        'mediaId', '37200000-0000-4000-8000-000000000002',
        'revisionId', '37300000-0000-4000-8000-000000000002',
        'alt', 'Residents in the district'
      ),
      'author', jsonb_build_object('key', null, 'name', 'Office staff'),
      'featured', false,
      'pinned', false,
      'seo', jsonb_build_object('title', '', 'description', '', 'canonicalUrl', null, 'socialImage', null, 'noIndex', false)
    ),
    'taxonomyKeys', jsonb_build_object('categories', jsonb_build_array(), 'tags', jsonb_build_array()),
    'taxonomySnapshot', jsonb_build_object(),
    'displayDate', '2026-08-07T04:00:00.000Z',
    'expiresAt', null
  ),
  '2026-08-07T04:00:00.000Z',
  '37100000-0000-4000-8000-000000000001'
);
select builder_private.capture_version_references(
  '37000000-0000-4000-8000-000000000001',
  '37400000-0000-4000-8000-000000000001',
  '37500000-0000-4000-8000-000000000001',
  (select snapshot from public.builder_entry_versions
   where site_id = '37000000-0000-4000-8000-000000000001'
     and entry_id = '37400000-0000-4000-8000-000000000001'
     and id = '37500000-0000-4000-8000-000000000001')
);

select throws_ok(
  $$ insert into public.builder_published_entries
    (site_id, entry_id, version_id, slug, title, excerpt, snapshot, display_date, first_published_at)
    select site_id, entry_id, id, slug, 'District update', 'Latest district news.', snapshot, display_date, now()
    from public.builder_entry_versions
    where site_id = '37000000-0000-4000-8000-000000000001'
      and entry_id = '37400000-0000-4000-8000-000000000001'
      and id = '37500000-0000-4000-8000-000000000001' $$,
  'P0001', 'MEDIA_RECOVERY_NOT_READY',
  'post publication is rejected until the exact managed revision is recovery-ready'
);

update public.builder_media_recovery_replicas
set status = 'ready', content_digest = repeat('b', 64), byte_size = 13,
    mime_type = 'image/webp', object_path = 'recovery/v1/preview/managed-media-recovery/media/pending.webp',
    verified_at = now(), updated_at = now()
where site_id = '37000000-0000-4000-8000-000000000001'
  and media_id = '37200000-0000-4000-8000-000000000002'
  and revision_id = '37300000-0000-4000-8000-000000000002';

select lives_ok(
  $$ insert into public.builder_published_entries
    (site_id, entry_id, version_id, slug, title, excerpt, snapshot, display_date, first_published_at)
    select site_id, entry_id, id, slug, 'District update', 'Latest district news.', snapshot, display_date, now()
    from public.builder_entry_versions
    where site_id = '37000000-0000-4000-8000-000000000001'
      and entry_id = '37400000-0000-4000-8000-000000000001'
      and id = '37500000-0000-4000-8000-000000000001' $$,
  'post publication succeeds after the exact revision is verified'
);

select throws_ok(
  $$ delete from public.builder_entry_version_media
     where site_id = '37000000-0000-4000-8000-000000000001'
       and version_id = '37500000-0000-4000-8000-000000000001' $$,
  '55000', 'immutable builder record cannot be updated or deleted',
  'historical post media references cannot be removed'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"37100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","email":"media-owner@example.test"}',
  true
);
set local role authenticated;
select throws_ok(
  $$ delete from public.builder_media_revisions
     where site_id = '37000000-0000-4000-8000-000000000001'
       and id = '37300000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table builder_media_revisions',
  'the editor role cannot delete canonical revision objects through application SQL'
);
reset role;

select * from finish();
rollback;
