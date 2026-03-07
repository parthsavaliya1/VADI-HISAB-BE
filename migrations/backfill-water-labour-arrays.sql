-- Backfill water_sources and labour_types from legacy water_source / labour_type
-- Run with: psql -d your_database -f migrations/backfill-water-labour-arrays.sql
-- Safe to run multiple times (only updates rows where new columns are empty and old have values).

-- Backfill water_sources when it's empty/null but water_source has a value
UPDATE farmer_profiles
SET water_sources = to_jsonb(ARRAY[water_source]::text[])
WHERE (water_sources IS NULL OR water_sources = '[]'::jsonb)
  AND water_source IS NOT NULL;

-- Backfill labour_types when it's empty/null but labour_type has a value
UPDATE farmer_profiles
SET labour_types = to_jsonb(ARRAY[labour_type]::text[])
WHERE (labour_types IS NULL OR labour_types = '[]'::jsonb)
  AND labour_type IS NOT NULL;
