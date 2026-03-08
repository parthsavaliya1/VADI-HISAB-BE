-- Allow general expense (સામાન્ય ખર્ચ) not linked to any crop.
-- Run once. Makes expenses.crop_id nullable.

ALTER TABLE expenses
  ALTER COLUMN crop_id DROP NOT NULL;
