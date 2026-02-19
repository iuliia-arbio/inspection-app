-- =============================================================================
-- MIGRATION: Switch deals/apartments link from deal_id (UUID) to deal_sku
-- Run this if you already have ins_deals and ins_apartments with the old schema
-- =============================================================================

-- 1. Add deal_sku to ins_deals
ALTER TABLE ins_deals ADD COLUMN IF NOT EXISTS deal_sku TEXT UNIQUE;
UPDATE ins_deals SET deal_sku = name WHERE deal_sku IS NULL;
ALTER TABLE ins_deals ALTER COLUMN deal_sku SET NOT NULL;

-- 2. Add deal_sku to ins_apartments and populate from deal
ALTER TABLE ins_apartments ADD COLUMN IF NOT EXISTS deal_sku TEXT;
UPDATE ins_apartments a SET deal_sku = d.deal_sku FROM ins_deals d WHERE a.deal_id = d.id;

-- 3. Drop old FK and column from ins_apartments
ALTER TABLE ins_apartments DROP CONSTRAINT IF EXISTS ins_apartments_deal_id_fkey;
ALTER TABLE ins_apartments DROP COLUMN IF EXISTS deal_id;

-- 4. Add new FK and index
ALTER TABLE ins_apartments ALTER COLUMN deal_sku SET NOT NULL;
ALTER TABLE ins_apartments ADD CONSTRAINT ins_apartments_deal_sku_fkey
  FOREIGN KEY (deal_sku) REFERENCES ins_deals(deal_sku) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_ins_apartments_deal_sku ON ins_apartments(deal_sku);
DROP INDEX IF EXISTS idx_ins_apartments_deal_id;

-- 5. Remove redundant name from ins_deals (deal_sku = name)
ALTER TABLE ins_deals DROP COLUMN IF EXISTS name;
