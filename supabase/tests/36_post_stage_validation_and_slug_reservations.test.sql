begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '36100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'post-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"Post Owner"}', now(), now()
);

insert into public.builder_sites (id, site_key, display_name)
values ('36000000-0000-4000-8000-000000000001', 'post-stage-test', 'Post Stage Test');
insert into public.builder_site_members (site_id, user_id, role)
values ('36000000-0000-4000-8000-000000000001', '36100000-0000-4000-8000-000000000001', 'owner');

create function pg_temp.post_snapshot(p_slug text, p_body text default '', p_alt text default null)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'slug', p_slug,
    'displayTimeZone', 'America/New_York',
    'data', jsonb_build_object(
      'title', 'District update',
      'excerpt', '',
      'body', jsonb_build_object(
        'version', 1,
        'type', 'doc',
        'content', case when p_body = '' then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
          'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_body))
        )) end
      ),
      'featuredImage', case when p_alt is null then 'null'::jsonb else jsonb_build_object(
        'kind', 'static', 'src', '/images/district-event.jpg', 'alt', p_alt
      ) end,
      'author', jsonb_build_object('key', null, 'name', 'Post Owner'),
      'featured', false,
      'pinned', false,
      'seo', jsonb_build_object('title', 'District update', 'description', '', 'canonicalUrl', null, 'socialImage', null, 'noIndex', false)
    ),
    'taxonomyKeys', jsonb_build_object('categories', jsonb_build_array(), 'tags', jsonb_build_array()),
    'taxonomySnapshot', jsonb_build_object(),
    'displayDate', '2026-08-07T04:00:00.000Z',
    'expiresAt', null
  );
$$;

select set_config('request.jwt.claims', '{"sub":"36100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","email":"post-owner@example.test"}', true);
set local role authenticated;

select lives_ok(
  $$ select public.builder_create_post(
    'post-stage-test', '36400000-0000-4000-8000-000000000001',
    pg_temp.post_snapshot('district-update'), 'create:post:first'
  ) $$,
  'a title-only draft can be created'
);
select lives_ok(
  $$ select public.builder_create_post(
    'post-stage-test', '36400000-0000-4000-8000-000000000002',
    pg_temp.post_snapshot('district-update'), 'create:post:second'
  ) $$,
  'an identical title receives another site-scoped slug'
);

select is(
  (
    select string_agg(version.slug, ',' order by version.slug)
    from public.builder_entries entry
    join public.builder_entry_versions version
      on version.site_id = entry.site_id and version.entry_id = entry.id and version.id = entry.active_draft_version_id
    where entry.site_id = '36000000-0000-4000-8000-000000000001'
  ),
  'district-update,district-update-2',
  'numeric suffixes are reserved deterministically inside the create transaction'
);

select throws_ok(
  $$ select public.builder_transition_post(
    'post-stage-test', 'publish',
    jsonb_build_object(
      'entryId', '36400000-0000-4000-8000-000000000001',
      'expectedDraftVersionId', (select active_draft_version_id from public.builder_entries where id = '36400000-0000-4000-8000-000000000001'),
      'expectedPublishedVersionId', null
    ),
    'publish:empty-body'
  ) $$,
  '22023', 'Add post body text before publishing.',
  'the database rejects publishing an empty rich-text body'
);

select lives_ok(
  $$ select public.builder_create_post(
    'post-stage-test', '36400000-0000-4000-8000-000000000003',
    pg_temp.post_snapshot('image-update', 'Body copy', 'Residents meeting at a district event'),
    'create:post:valid'
  ) $$,
  'a publish-ready post draft can be created'
);
select lives_ok(
  $$ select public.builder_transition_post(
    'post-stage-test', 'publish',
    jsonb_build_object(
      'entryId', '36400000-0000-4000-8000-000000000003',
      'expectedDraftVersionId', (select active_draft_version_id from public.builder_entries where id = '36400000-0000-4000-8000-000000000003'),
      'expectedPublishedVersionId', null
    ),
    'publish:valid'
  ) $$,
  'a post with body text and descriptive image alt text can publish'
);

select lives_ok(
  $$ select public.builder_create_post(
    'post-stage-test', '36400000-0000-4000-8000-000000000004',
    pg_temp.post_snapshot('filename-alt', 'Body copy', 'IMG_0042.jpg'),
    'create:post:filename-alt'
  ) $$,
  'a draft may retain a filename alt value until publishing'
);
select throws_ok(
  $$ select public.builder_transition_post(
    'post-stage-test', 'publish',
    jsonb_build_object(
      'entryId', '36400000-0000-4000-8000-000000000004',
      'expectedDraftVersionId', (select active_draft_version_id from public.builder_entries where id = '36400000-0000-4000-8000-000000000004'),
      'expectedPublishedVersionId', null
    ),
    'publish:filename-alt'
  ) $$,
  '22023', 'Describe the image instead of using its filename.',
  'the database rejects a filename-only image description at publish time'
);

reset role;
select * from finish();
rollback;
