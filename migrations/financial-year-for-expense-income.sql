-- Store fiscal financial-year strings (like crops.year = "2025-26") in:
--   - expenses.year
--   - incomes.year
--
-- After this, list screens and dashboards can filter by FY using `where.year = financialYear`.
-- Run this once in production before deploying the code changes.

BEGIN;

-- 1) Convert column types to VARCHAR (keep existing values as text temporarily).
ALTER TABLE expenses
  ALTER COLUMN year TYPE VARCHAR(10) USING year::text;

ALTER TABLE incomes
  ALTER COLUMN year TYPE VARCHAR(10) USING year::text;

-- 2) For crop-linked rows, copy FY from crops.year.
UPDATE expenses e
SET year = c.year
FROM crops c
WHERE e.crop_id IS NOT NULL
  AND e.crop_id = c.id;

UPDATE incomes i
SET year = c.year
FROM crops c
WHERE i.crop_id IS NOT NULL
  AND i.crop_id = c.id;

-- 3) For general (no crop) rows, compute FY from `date` (June..May).
UPDATE expenses e
SET year =
  CASE
    WHEN EXTRACT(MONTH FROM e.date) >= 6 THEN
      (EXTRACT(YEAR FROM e.date)::int)::text || '-' ||
      LPAD(((EXTRACT(YEAR FROM e.date)::int + 1) % 100)::text, 2, '0')
    ELSE
      (EXTRACT(YEAR FROM e.date)::int - 1)::text || '-' ||
      LPAD((EXTRACT(YEAR FROM e.date)::int % 100)::text, 2, '0')
  END
WHERE e.crop_id IS NULL;

UPDATE incomes i
SET year =
  CASE
    WHEN EXTRACT(MONTH FROM i.date) >= 6 THEN
      (EXTRACT(YEAR FROM i.date)::int)::text || '-' ||
      LPAD(((EXTRACT(YEAR FROM i.date)::int + 1) % 100)::text, 2, '0')
    ELSE
      (EXTRACT(YEAR FROM i.date)::int - 1)::text || '-' ||
      LPAD((EXTRACT(YEAR FROM i.date)::int % 100)::text, 2, '0')
  END
WHERE i.crop_id IS NULL;

COMMIT;

