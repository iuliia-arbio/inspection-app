-- Migration: Add listing links and hostaway_listing_id to apartments (from n8n workflow)
-- listing links: used for accuracy questions — inspectors can open listings in new tab
-- hostaway_listing_id: Hostaway listing identifier

ALTER TABLE ins_apartments
  ADD COLUMN IF NOT EXISTS booking_com_url TEXT,
  ADD COLUMN IF NOT EXISTS airbnb_url TEXT,
  ADD COLUMN IF NOT EXISTS hostaway_listing_id TEXT;
