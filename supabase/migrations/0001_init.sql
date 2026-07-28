-- Wayfare — initial schema
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
--
-- SECURITY MODEL (anonymous / link-based access)
-- ---------------------------------------------
-- There is no Supabase Auth user in V0. Membership is proven by a per-member
-- secret held in an httpOnly cookie and verified server-side in Next.js route
-- handlers, which talk to Postgres with the service role key.
--
-- Therefore: RLS is ENABLED on every table and NO policies are created. That
-- means the public `anon` key can read and write NOTHING. This is deliberate --
-- it is the property that makes anonymous mode safe. Do not add permissive
-- policies without also introducing real auth.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------
create table if not exists trips (
  id             uuid primary key default gen_random_uuid(),
  -- Short, human-speakable code for "join by code" (e.g. MISTY-KARST-472).
  join_code      text unique not null,
  -- Long unguessable token; this is the credential embedded in invite links.
  invite_token   text unique not null,
  name           text not null,
  destination    text not null,
  start_date     date,
  end_date       date,
  party_size     integer not null default 1 check (party_size between 1 and 50),
  budget_level   text check (budget_level in ('shoestring','value','comfort','luxury')),
  currency       text not null default 'INR',
  -- Free-text notes the creator gives at setup; feeds the AI context.
  brief          text,
  -- When locked, no new members may join via link or code.
  locked         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
create table if not exists members (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references trips(id) on delete cascade,
  display_name  text not null check (length(trim(display_name)) between 1 and 40),
  avatar_emoji  text not null default '🙂',
  -- Tailwind-ish accent token chosen at join time, for avatars and vote chips.
  color         text not null default 'amber',
  role          text not null default 'member' check (role in ('owner','member')),
  -- sha256(member_secret). The raw secret only ever lives in the member's cookie.
  secret_hash   text not null,
  removed       boolean not null default false,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists members_trip_idx on members(trip_id) where removed = false;
create unique index if not exists members_secret_idx on members(secret_hash);

-- ---------------------------------------------------------------------------
-- preferences  (the raw material for Group DNA)
-- ---------------------------------------------------------------------------
create table if not exists preferences (
  member_id        uuid primary key references members(id) on delete cascade,
  trip_id          uuid not null references trips(id) on delete cascade,
  pace             text check (pace in ('chill','balanced','packed')),
  budget_level     text check (budget_level in ('shoestring','value','comfort','luxury')),
  -- e.g. {food,nature,nightlife,culture,adventure,photography,shopping,wellness}
  interests        text[] not null default '{}',
  wake_time        text check (wake_time in ('early','mid','late')),
  dietary          text[] not null default '{}',
  -- Physical intensity the member is up for; drives feasibility warnings.
  intensity        text check (intensity in ('low','moderate','high')),
  -- "I am doing the Ha Giang loop or I am not coming." Weighted heavily by the AI.
  non_negotiables  text,
  updated_at       timestamptz not null default now()
);

create index if not exists preferences_trip_idx on preferences(trip_id);

-- ---------------------------------------------------------------------------
-- ideas  (candidate places / activities on the shortlist board)
-- ---------------------------------------------------------------------------
create table if not exists ideas (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references trips(id) on delete cascade,
  title          text not null,
  category       text not null default 'sight'
                   check (category in ('sight','food','activity','stay','transport','experience')),
  -- Which town/region this sits in; used to cluster days geographically.
  locality       text,
  description    text,
  -- One line explaining the fit against this specific group's DNA.
  why_fits       text,
  rating         numeric(2,1) check (rating between 0 and 5),
  rating_count   integer,
  price_note     text,
  duration_hours numeric(4,1),
  best_time      text,
  booking_url    text,
  image_url      text,
  lat            numeric(9,6),
  lng            numeric(9,6),
  source         text not null default 'ai' check (source in ('ai','member','link')),
  -- Citations from Gemini Search grounding: [{"title":..., "uri":...}]
  sources        jsonb not null default '[]'::jsonb,
  -- False when generated without Search grounding -> UI shows "unverified".
  grounded       boolean not null default false,
  added_by       uuid references members(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists ideas_trip_idx on ideas(trip_id);

-- ---------------------------------------------------------------------------
-- reactions  (🔥 must / 👍 keen / 😐 meh / ❌ no)
-- ---------------------------------------------------------------------------
create table if not exists reactions (
  idea_id     uuid not null references ideas(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  value       text not null check (value in ('must','keen','meh','no')),
  created_at  timestamptz not null default now(),
  primary key (idea_id, member_id)
);

create index if not exists reactions_member_idx on reactions(member_id);

-- ---------------------------------------------------------------------------
-- itinerary
-- ---------------------------------------------------------------------------
create table if not exists itinerary_items (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references trips(id) on delete cascade,
  -- 0-based offset from trips.start_date.
  day_index     integer not null check (day_index >= 0),
  -- Minutes from local midnight, so ordering is trivial and timezone-free.
  start_min     integer not null default 540 check (start_min between 0 and 1439),
  duration_min  integer not null default 60 check (duration_min > 0),
  idea_id       uuid references ideas(id) on delete set null,
  title         text not null,
  kind          text not null default 'activity'
                  check (kind in ('activity','meal','travel','rest','checkin')),
  notes         text,
  -- Populated by the feasibility engine: [{"level":"warn","message":"..."}]
  warnings      jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists itinerary_trip_day_idx on itinerary_items(trip_id, day_index, start_min);

-- ---------------------------------------------------------------------------
-- messages  (AI Concierge transcript, shared across the group)
-- ---------------------------------------------------------------------------
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  member_id   uuid references members(id) on delete set null,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  sources     jsonb not null default '[]'::jsonb,
  grounded    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists messages_trip_idx on messages(trip_id, created_at);

-- ---------------------------------------------------------------------------
-- Lock everything down. Service role bypasses RLS; anon key gets nothing.
-- ---------------------------------------------------------------------------
alter table trips            enable row level security;
alter table members          enable row level security;
alter table preferences      enable row level security;
alter table ideas            enable row level security;
alter table reactions        enable row level security;
alter table itinerary_items  enable row level security;
alter table messages         enable row level security;
