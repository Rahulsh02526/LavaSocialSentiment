-- ============================================================
-- Social Intelligence Platform — Supabase Schema
-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New Query)
-- ============================================================

-- ---------- MODELS ----------
create table if not exists models (
  model_id integer primary key,
  model text not null,
  rank_original text,
  launch_date date,
  launch_price_inr numeric,
  amazon_available text,
  flipkart_available text,
  amazon_rating numeric,
  amazon_num_ratings integer,
  flipkart_rating numeric,
  flipkart_num_ratings integer,
  amazon_camera numeric, amazon_battery numeric, amazon_display numeric,
  amazon_design numeric, amazon_performance numeric, amazon_build numeric, amazon_vfm numeric,
  flipkart_camera numeric, flipkart_battery numeric, flipkart_display numeric,
  flipkart_design numeric, flipkart_performance numeric, flipkart_build numeric, flipkart_vfm numeric,
  date_of_capture date,
  price_segment text,           -- budget | entry_mid | mid | upper_mid | premium_mid
  brand text,
  brand_tier integer,            -- 1, 2, or null (ad-hoc)
  sentiment_frozen_at date,      -- launch + 6 months
  price_frozen_at date,          -- launch + 12 months
  image_url text,                -- product photo, added later
  created_at timestamptz default now()
);

-- ---------- SPECS (1:1 with models) ----------
create table if not exists specs (
  model_id integer primary key references models(model_id) on delete cascade,
  processor text,
  ram_variants text[],
  storage_variants text[],
  display text,
  battery_mah integer,
  fast_charging_w integer,
  rear_camera text,
  front_camera text,
  os text,
  connectivity text,
  weight_g integer,
  source_confidence text
);

-- ---------- COMMENTS ----------
create table if not exists comments (
  id text primary key,           -- source_modelid_hash, same scheme as the artifact version
  model_id integer references models(model_id) on delete cascade,
  source text not null,          -- Amazon | Flipkart | YouTube
  comment_text text not null,
  comment_date date,             -- nullable; YouTube pulls populate this, manual e-com pastes may not
  created_at timestamptz default now()
);
create index if not exists idx_comments_model on comments(model_id);

-- ---------- TAGS (4-layer tagging output, 1:1 with comments) ----------
create table if not exists tags (
  comment_id text primary key references comments(id) on delete cascade,
  sentiment text,                 -- positive | negative | neutral | mixed
  mentions jsonb,                 -- [{parameter, sentiment}, ...]
  narrative text,
  strategic_theme text,           -- nullable, one of 8 themes
  tagged_at timestamptz default now()
);

-- ---------- YOUTUBE VIDEO MAP ----------
create table if not exists video_map (
  model_id integer primary key references models(model_id) on delete cascade,
  video_id text not null,
  title text,
  channel text,
  mapped_at timestamptz default now(),
  last_fetched_at timestamptz,
  newest_comment_seen timestamptz
);

-- ---------- MARKETING ASSETS ----------
create table if not exists marketing_assets (
  id text primary key,
  model_id integer references models(model_id) on delete cascade,
  type text,                      -- image | video
  platform text,                  -- YouTube | Instagram | Other
  campaign_name text,
  asset_date date,
  url text not null,
  tags text[],
  notes text,
  created_at timestamptz default now()
);
create index if not exists idx_assets_model on marketing_assets(model_id);

-- ---------- FETCH PROGRESS (drives the daily cron batching) ----------
create table if not exists fetch_progress (
  model_id integer primary key references models(model_id) on delete cascade,
  search_completed boolean default false,    -- has search.list been run to find a video?
  search_completed_at timestamptz,
  comments_fetched_at timestamptz,           -- last successful commentThreads pull
  status text default 'pending',             -- pending | searched | fetched | no_video_found | error
  error_message text,
  updated_at timestamptz default now()
);

-- ---------- QUOTA LOG (server tracks its own YouTube usage, since Google doesn't return remaining quota) ----------
create table if not exists quota_log (
  id bigint generated always as identity primary key,
  log_date date not null default current_date,
  units_used integer not null,
  call_type text not null,        -- search.list | commentThreads.list
  model_id integer,
  created_at timestamptz default now()
);
create index if not exists idx_quota_log_date on quota_log(log_date);

-- ============================================================
-- Row Level Security — disabled for now since this is a single-user
-- internal tool accessed only via server-side service-role calls.
-- If you later add a login for multiple people, enable RLS and add
-- policies before exposing any table to client-side queries directly.
-- ============================================================
alter table models disable row level security;
alter table specs disable row level security;
alter table comments disable row level security;
alter table tags disable row level security;
alter table video_map disable row level security;
alter table marketing_assets disable row level security;
alter table fetch_progress disable row level security;
alter table quota_log disable row level security;
