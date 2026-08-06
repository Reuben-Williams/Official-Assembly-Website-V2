create table public.builder_versions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  page_path text not null check (page_path like '/%'),
  status text not null check (status in ('draft', 'published', 'rollback', 'undoRollback')),
  snapshot jsonb not null,
  user_id text not null,
  created_at timestamptz not null default now()
);

create table public.builder_draft_pages (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  path text not null check (path like '/%'),
  regions jsonb not null default '{}'::jsonb,
  version_id uuid references public.builder_versions(id),
  updated_at timestamptz not null default now(),
  primary key (site_id, path)
);

create table public.builder_published_pages (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  path text not null check (path like '/%'),
  regions jsonb not null default '{}'::jsonb,
  version_id uuid references public.builder_versions(id),
  updated_at timestamptz not null default now(),
  primary key (site_id, path)
);

create table public.builder_audit_log (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  page_path text not null check (page_path like '/%'),
  action text not null check (
    action in ('draft.saved', 'version.published', 'version.rolled_back', 'rollback.undone', 'media.uploaded')
  ),
  user_id text not null,
  user_label text,
  summary text not null,
  region_id text,
  kind text check (kind in ('text', 'richText', 'image', 'link', 'sections', 'icon')),
  before jsonb,
  after jsonb,
  version_id uuid references public.builder_versions(id),
  source_version_id uuid references public.builder_versions(id),
  result_version_id uuid references public.builder_versions(id),
  created_at timestamptz not null default now()
);

create index builder_versions_site_page_created_idx
  on public.builder_versions (site_id, page_path, created_at desc);

create index builder_audit_log_site_created_idx
  on public.builder_audit_log (site_id, created_at desc);

alter table public.builder_versions enable row level security;
alter table public.builder_draft_pages enable row level security;
alter table public.builder_published_pages enable row level security;
alter table public.builder_audit_log enable row level security;

revoke all on public.builder_versions from anon, authenticated;
revoke all on public.builder_draft_pages from anon, authenticated;
revoke all on public.builder_published_pages from anon, authenticated;
revoke all on public.builder_audit_log from anon, authenticated;

grant select, insert on public.builder_versions to service_role;
grant select, insert, update, delete on public.builder_draft_pages to service_role;
grant select, insert, update, delete on public.builder_published_pages to service_role;
grant select, insert on public.builder_audit_log to service_role;
