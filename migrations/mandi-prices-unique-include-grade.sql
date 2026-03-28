-- Run once in Supabase SQL editor (or psql) after deploying BE code that upserts on grade.
-- Reason: data.gov.in returns multiple rows per mandi/commodity that differ only by grade (FAQ, Local, etc.).
-- The old unique key omitted grade, so each upsert overwrote the previous → only ~tens of rows in the table.

ALTER TABLE public.mandi_prices
  DROP CONSTRAINT IF EXISTS uq_mandi_district_market_commodity_variety_arrival;

ALTER TABLE public.mandi_prices
  ADD CONSTRAINT uq_mandi_district_market_commodity_variety_grade_arrival
  UNIQUE (district, market, commodity, variety, grade, arrival_date);

-- Then re-run sync: POST /api/mandi/sync-all with the same date to backfill all grades/markets.
