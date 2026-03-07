-- Add farm_name to crops for area validation per farm
ALTER TABLE crops
  ADD COLUMN IF NOT EXISTS farm_name VARCHAR(80) DEFAULT NULL;

COMMENT ON COLUMN crops.farm_name IS 'Farm name from profile e.g. vadi, farm-2';
