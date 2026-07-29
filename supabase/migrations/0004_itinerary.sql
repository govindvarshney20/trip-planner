-- Wayfare — the working itinerary
--
-- Run in the Supabase SQL Editor after 0003_flexible_dates.sql.
--
-- Replaces the three-blueprint model with a single working plan the group
-- edits together. Voting between whole trips was a lot to read on a phone and
-- only ever produced one decision; per-stop votes and alternatives give the
-- same pushback continuously and specifically.
--
-- Existing trips are intentionally not migrated -- the blueprint tables are
-- dropped rather than converted.

drop table if exists plan_votes;
drop table if exists plan_days;
drop table if exists plans;
-- Superseded by plan_stops, and never used by any shipped UI.
drop table if exists itinerary_items;

alter table trips drop column if exists plans_revealed_at;

-- plans_state / plans_claimed_at are reused as the itinerary's generation
-- state, so there is one generation lock rather than two.
comment on column trips.plans_state is
  'Itinerary generation state: none | generating | ready | failed';

-- ---------------------------------------------------------------------------
-- trip_days — day-level framing
-- ---------------------------------------------------------------------------
create table if not exists trip_days (
  trip_id     uuid not null references trips(id) on delete cascade,
  day_index   integer not null check (day_index >= 0),
  -- e.g. "Hanoi to Ha Giang"
  title       text not null,
  locality    text,
  summary     text,
  -- Feasibility findings for the day as a whole:
  -- [{"level":"warn|clash","message":"..."}]
  warnings    jsonb not null default '[]'::jsonb,
  primary key (trip_id, day_index)
);

-- ---------------------------------------------------------------------------
-- plan_stops — the individual things you do
-- ---------------------------------------------------------------------------
create table if not exists plan_stops (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references trips(id) on delete cascade,
  day_index      integer not null check (day_index >= 0),
  -- Order within the day. Gaps are fine and expected: reordering rewrites
  -- these, and spacing them out avoids a cascade of updates per move.
  position       integer not null default 0,
  title          text not null,
  locality       text,
  kind           text not null default 'activity'
                   check (kind in ('activity','meal','travel','stay','rest')),
  summary        text,
  -- Why this is in THIS group's plan, not a generic description.
  why_included   text,
  duration_hours numeric(4,1),
  cost_note      text,
  best_time      text,
  status         text not null default 'proposed'
                   check (status in ('proposed','accepted','removed')),

  -- Deep detail, fetched only when someone opens the stop and then cached
  -- forever. Generating this for ~30 stops upfront would mean minutes of
  -- waiting and a grounded lookup per stop, most of them never read.
  detail             jsonb,
  detail_sources     jsonb not null default '[]'::jsonb,
  detail_grounded    boolean not null default false,
  detail_fetched_at  timestamptz,

  created_at     timestamptz not null default now()
);

create index if not exists plan_stops_trip_idx
  on plan_stops(trip_id, day_index, position);

-- ---------------------------------------------------------------------------
-- stop_alternatives
--
-- A "no" should always come with an "instead?". Alternatives are generated per
-- stop so removing something never leaves a hole in the day.
-- ---------------------------------------------------------------------------
create table if not exists stop_alternatives (
  id             uuid primary key default gen_random_uuid(),
  stop_id        uuid not null references plan_stops(id) on delete cascade,
  title          text not null,
  locality       text,
  summary        text,
  why            text,
  duration_hours numeric(4,1),
  cost_note      text,
  sources        jsonb not null default '[]'::jsonb,
  grounded       boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists stop_alternatives_stop_idx on stop_alternatives(stop_id);

-- ---------------------------------------------------------------------------
-- stop_votes
-- ---------------------------------------------------------------------------
create table if not exists stop_votes (
  stop_id     uuid not null references plan_stops(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  trip_id     uuid not null references trips(id) on delete cascade,
  value       text not null check (value in ('keep','drop')),
  created_at  timestamptz not null default now(),
  primary key (stop_id, member_id)
);

create index if not exists stop_votes_trip_idx on stop_votes(trip_id);

alter table trip_days         enable row level security;
alter table plan_stops        enable row level security;
alter table stop_alternatives enable row level security;
alter table stop_votes        enable row level security;
