-- Add farms array to farmer_profiles: [{ name: "vadi", area: 30 }, ...]
-- Run once. Safe to run if column already exists (will error; ignore or use IF NOT EXISTS pattern).

ALTER TABLE farmer_profiles
  ADD COLUMN IF NOT EXISTS farms JSONB DEFAULT '[]';

COMMENT ON COLUMN farmer_profiles.farms IS 'Farms with name and area in bigha: [{ "name": "vadi", "area": 30 }]';
