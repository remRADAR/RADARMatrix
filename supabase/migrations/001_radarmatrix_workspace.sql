create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id text primary key,
  name text not null,
  policy_version text not null default '0.1',
  policy_status text not null default 'active' check (policy_status in ('active', 'draft', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  caller_id text not null,
  role text not null check (role in ('viewer', 'contributor', 'editor', 'admin')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, caller_id)
);

create table if not exists public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  asset_type text not null,
  description text not null default '',
  tags text[] not null default '{}',
  version text not null default '0.1',
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  title text not null,
  format text not null,
  channel text not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'scheduled', 'published', 'blocked')),
  body jsonb not null default '{}',
  requires_approval boolean not null default true,
  consent_required boolean not null default false,
  consent_recorded_at timestamptz,
  created_by text not null,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  external_id text,
  channel text not null default 'instagram',
  kind text not null,
  title text not null,
  state text not null default 'review',
  payload jsonb not null default '{}',
  consent_state text not null default 'unknown' check (consent_state in ('unknown', 'granted', 'revoked', 'not_required')),
  assigned_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_state (
  workspace_id text primary key references public.workspaces(id) on delete cascade,
  account_state text not null default 'healthy_observe_only',
  mutation_pause boolean not null default true,
  circuit_breakers jsonb not null default '{}',
  webhook_health jsonb not null default '{}',
  rate_budgets jsonb not null default '{}',
  updated_by text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.rate_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  account_key text not null,
  action_key text not null,
  occurred_at timestamptz not null default now(),
  request_id text not null,
  outcome text not null check (outcome in ('admitted', 'blocked', 'provider_rejected'))
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  request_id text not null,
  caller_id text not null,
  tool text not null,
  action text,
  is_write boolean not null default false,
  success boolean not null,
  error_code text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_brand_assets_workspace_updated on public.brand_assets (workspace_id, updated_at desc);
create index if not exists idx_content_items_workspace_status on public.content_items (workspace_id, status, updated_at desc);
create index if not exists idx_community_items_workspace_state on public.community_items (workspace_id, state, updated_at desc);
create index if not exists idx_rate_events_window on public.rate_events (workspace_id, account_key, action_key, occurred_at desc);
create index if not exists idx_audit_events_workspace_created on public.audit_events (workspace_id, created_at desc);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.brand_assets enable row level security;
alter table public.content_items enable row level security;
alter table public.community_items enable row level security;
alter table public.safety_state enable row level security;
alter table public.rate_events enable row level security;
alter table public.audit_events enable row level security;

insert into public.workspaces (id, name, policy_version, policy_status)
values ('w_dev', 'remRADAR', '0.4', 'active')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, caller_id, role)
values
  ('w_dev', 'admin_123', 'admin'),
  ('w_dev', 'editor_456', 'editor'),
  ('w_dev', 'contributor_789', 'contributor'),
  ('w_dev', 'viewer_000', 'viewer')
on conflict (workspace_id, caller_id) do nothing;

insert into public.safety_state (workspace_id, account_state, mutation_pause, updated_by)
values ('w_dev', 'healthy_observe_only', true, 'migration')
on conflict (workspace_id) do nothing;
