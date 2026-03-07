-- Keep only one column each: water_sources (jsonb) and labour_types (jsonb).
-- Run this AFTER backfilling (or if water_sources/labour_types already have data).

-- Step 1: Backfill from old columns if new ones are empty (safe to run first)
UPDATE farmer_profiles
SET water_sources = to_jsonb(ARRAY[water_source]::text[])
WHERE (water_sources IS NULL OR water_sources = '[]'::jsonb) AND water_source IS NOT NULL;

UPDATE farmer_profiles
SET labour_types = to_jsonb(ARRAY[labour_type]::text[])
WHERE (labour_types IS NULL OR labour_types = '[]'::jsonb) AND labour_type IS NOT NULL;

-- Step 2: Drop the old single-value columns (only one column remains for each)
ALTER TABLE farmer_profiles DROP COLUMN IF EXISTS water_source;
ALTER TABLE farmer_profiles DROP COLUMN IF EXISTS labour_type;
