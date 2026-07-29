-- Wayfare — flexible dates and a lighter create flow
--
-- Run in the Supabase SQL Editor after 0002_plans.sql.
--
-- The create form now asks for a month and a number of days rather than exact
-- dates. Most people planning a trip know "nine days in October" long before
-- they know "24 Oct to 1 Nov", and demanding precise dates at the door loses
-- them. Exact dates are collected later, when the group locks the plan and it
-- actually matters for ferries, closures and pricing.

alter table trips
  -- 'YYYY-MM'. Enough to ground weather and season without pinning a date.
  add column if not exists travel_month text,
  -- Length of the trip in days. Authoritative when start_date/end_date are null.
  add column if not exists day_count integer check (day_count between 1 and 60);

-- Exact dates become optional rather than the primary source of truth.
comment on column trips.start_date is
  'Optional. Set once the group commits to specific dates; travel_month + day_count carry the plan until then.';

-- Backfill day_count for trips created under the old flow so length is always
-- readable from one place.
update trips
set day_count = (end_date - start_date) + 1
where day_count is null
  and start_date is not null
  and end_date is not null;

update trips
set travel_month = to_char(start_date, 'YYYY-MM')
where travel_month is null
  and start_date is not null;
