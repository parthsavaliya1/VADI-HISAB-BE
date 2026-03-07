-- Crop year: from calendar year (integer or varchar) to financial year (string) e.g. 2025-26 (June 2025 to May 2026).
-- Run once. Converts existing year 2025 or '2025' -> "2025-26". Safe if column is already integer or varchar.

ALTER TABLE crops
  ALTER COLUMN year TYPE VARCHAR(10)
  USING (
    CASE
      WHEN year::text ~ '^\d{4}-\d{2}$' THEN year::text
      ELSE SUBSTRING(year::text FROM 1 FOR 4) || '-' ||
           SUBSTRING(((SUBSTRING(year::text FROM 1 FOR 4)::integer + 1)::text) FROM 3 FOR 2)
    END
  );
