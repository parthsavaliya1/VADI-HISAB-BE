-- For bhagma crops: optional extra expense as % of crop income (shared by bhagma %)
ALTER TABLE crops
  ADD COLUMN IF NOT EXISTS bhagma_expense_pct_of_income DECIMAL(5,2) DEFAULT NULL;

COMMENT ON COLUMN crops.bhagma_expense_pct_of_income IS 'When bhagma: extra expense as % of crop income (e.g. 10 = 10%), shared by bhagma share';
