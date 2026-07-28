-- Wayfare — Blueprints: auto-generated whole-trip options with blind voting
--
-- Run in the Supabase SQL Editor after 0001_init.sql.
--
-- The idea: the moment a trip exists we generate three genuinely different,
-- internally coherent plans from the creator's brief alone -- before any member
-- has stated a preference, so no one person's taste skews the starting point.
-- The group then votes between whole trips rather than approving a single
-- proposal, which is a much more informative question.

-- ---------------------------------------------------------------------------
-- Generation state on the trip
--
-- Generation takes ~30s and several members may open the tab at once. A claim
-- column makes "exactly one generation runs" enforceable with a conditional
-- update rather than hope.
-- ---------------------------------------------------------------------------
alter table trips
  add column if not exists plans_state text not null default 'none'
    check (plans_state in ('none','generating','ready','failed')),
  add column if not exists plans_claimed_at timestamptz,
  -- Votes stay hidden until this is set. Blind voting is the whole point:
  -- visible tallies produce bandwagons, not opinions.
  add column if not exists plans_revealed_at timestamptz;

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
create table if not exists plans (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references trips(id) on delete cascade,
  -- Short evocative name, e.g. "The Ha Giang Deep Cut".
  label          text not null,
  tagline        text not null,
  -- What this plan deliberately gives up. Required: a plan with no stated
  -- sacrifice is usually an incoherent plan that promises everything.
  tradeoff       text not null,
  -- Rough per-person total in the trip's currency, excluding flights.
  cost_estimate  text,
  intensity      text check (intensity in ('low','moderate','high')),
  best_for       text,
  sources        jsonb not null default '[]'::jsonb,
  grounded       boolean not null default false,
  -- Stable per-plan sort key used to derive a per-member display order.
  seed           integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists plans_trip_idx on plans(trip_id);

-- ---------------------------------------------------------------------------
-- plan_days
--
-- Items live as jsonb rather than their own table: they are generated and read
-- as a whole day, never queried individually. When a plan is adopted its items
-- get promoted into itinerary_items, which is the relational one.
-- ---------------------------------------------------------------------------
create table if not exists plan_days (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references plans(id) on delete cascade,
  day_index  integer not null check (day_index >= 0),
  title      text not null,
  locality   text,
  summary    text,
  -- [{"title":..., "kind":"activity|meal|travel|rest", "duration_hours":n, "note":...}]
  items      jsonb not null default '[]'::jsonb,
  -- Feasibility findings: [{"level":"warn|clash","message":"..."}]
  warnings   jsonb not null default '[]'::jsonb,
  unique (plan_id, day_index)
);

create index if not exists plan_days_plan_idx on plan_days(plan_id, day_index);

-- ---------------------------------------------------------------------------
-- plan_votes
-- ---------------------------------------------------------------------------
create table if not exists plan_votes (
  plan_id     uuid not null references plans(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  trip_id     uuid not null references trips(id) on delete cascade,
  -- 1 = first choice. Ranking beats approval here: with three options we want
  -- to know the order, not just the favourite.
  rank        integer not null check (rank between 1 and 5),
  created_at  timestamptz not null default now(),
  primary key (plan_id, member_id)
);

-- One rank value per member per trip: no ranking two plans joint-first.
create unique index if not exists plan_votes_unique_rank
  on plan_votes(trip_id, member_id, rank);

create index if not exists plan_votes_trip_idx on plan_votes(trip_id);

alter table plans      enable row level security;
alter table plan_days  enable row level security;
alter table plan_votes enable row level security;
