-- =============================================================================
-- MIGRATION: Drop ins_deals.name, rename ins_apartments.name to apartment_sku
-- Run this if you already have deal_sku but still have name on deals, and name on apartments
-- =============================================================================

-- 1. Drop name from ins_deals (deal_sku is the display name)
ALTER TABLE ins_deals DROP COLUMN IF EXISTS name;

-- 2. Rename ins_apartments.name to apartment_sku
ALTER TABLE ins_apartments RENAME COLUMN name TO apartment_sku;
