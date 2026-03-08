-- Move data sharing (analytics consent) from users to farmer_profiles.
-- Run once. Backfill from users.analytics_consent so existing consent is preserved.

-- Add column on farmer_profiles
ALTER TABLE farmer_profiles
  ADD COLUMN IF NOT EXISTS data_sharing BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN farmer_profiles.data_sharing IS 'Analytics/data sharing consent; moved from users.analytics_consent';

-- Backfill: copy consent from users to farmer_profiles for existing profiles
UPDATE farmer_profiles fp
SET data_sharing = u.analytics_consent
FROM users u
WHERE fp.user_id = u.id
  AND u.analytics_consent IS NOT NULL
  AND fp.data_sharing IS NULL;
