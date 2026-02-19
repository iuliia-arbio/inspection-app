-- =============================================================================
-- INSPECTION APP - SUPABASE SCHEMA
-- Data pushed from n8n workflow (same source as Notion)
-- All tables prefixed with ins_
-- Deals and apartments linked by deal_sku (internal deal identifier)
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- ins_deals
-- deal_sku: internal identifier and display name (e.g. "DE_BER_014_Apartmently_019")
-- focus_areas: deal-level issues for shared areas (exterior, common)
-- -----------------------------------------------------------------------------
CREATE TABLE ins_deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_sku TEXT UNIQUE NOT NULL,                -- Deal identifier / display name
  notion_page_id TEXT UNIQUE NOT NULL,
  focus_areas JSONB DEFAULT '[]',                -- [{ category, issues[] }] for shared areas
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- focus_areas structure:
-- [{ "category": "check-in", "issues": ["Access Complication"] }, ...]

CREATE INDEX idx_ins_deals_deal_sku ON ins_deals(deal_sku);
CREATE INDEX idx_ins_deals_notion_page_id ON ins_deals(notion_page_id);

-- -----------------------------------------------------------------------------
-- ins_apartments
-- deal_sku: links to ins_deals.deal_sku (not UUID)
-- apartment_sku: apartment identifier (e.g. "A101", "A102")
-- issues: apartment-level known issues (for unit area deep-dives)
-- -----------------------------------------------------------------------------
CREATE TABLE ins_apartments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_sku TEXT NOT NULL REFERENCES ins_deals(deal_sku) ON DELETE CASCADE,
  notion_page_id TEXT UNIQUE NOT NULL,
  apartment_sku TEXT NOT NULL,                   -- e.g., "A101", "A102"
  issues TEXT[] DEFAULT '{}',                    -- Known issues from reviews
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ins_apartments_deal_sku ON ins_apartments(deal_sku);

-- -----------------------------------------------------------------------------
-- ins_inspections
-- One record per inspection session
-- deal_id: UUID link to ins_deals (used by app for URLs/routing)
-- -----------------------------------------------------------------------------
CREATE TABLE ins_inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID REFERENCES ins_deals(id) ON DELETE CASCADE,
  inspector_name TEXT,
  status TEXT DEFAULT 'in_progress',           -- in_progress, completed, submitted
  unit_configs JSONB DEFAULT '{}',             -- { "apartment_id": { bedrooms: 2, bathrooms: 1 } }
  selected_unit_ids UUID[] DEFAULT '{}',       -- Which apartments being inspected
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ins_inspections_deal_id ON ins_inspections(deal_id);
CREATE INDEX idx_ins_inspections_status ON ins_inspections(status);

-- -----------------------------------------------------------------------------
-- ins_area_recordings
-- One record per area; transcription triggered per-area (not per-block)
-- -----------------------------------------------------------------------------
CREATE TABLE ins_area_recordings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID REFERENCES ins_inspections(id) ON DELETE CASCADE,
  apartment_id UUID REFERENCES ins_apartments(id) ON DELETE SET NULL,  -- NULL for shared areas
  area_id TEXT NOT NULL,                       -- e.g., "exterior", "kitchen", "bedroom_1"
  area_name TEXT NOT NULL,
  scope TEXT NOT NULL,                         -- "shared" or "unit"
  audio_path TEXT,
  audio_duration_seconds INTEGER,
  transcript TEXT,
  transcript_status TEXT DEFAULT 'pending',    -- pending, processing, completed, failed
  ai_score INTEGER,                            -- 1-10, AI-derived after transcript
  ai_score_reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ins_area_recordings_inspection_id ON ins_area_recordings(inspection_id);
CREATE INDEX idx_ins_area_recordings_apartment_id ON ins_area_recordings(apartment_id);

-- -----------------------------------------------------------------------------
-- ins_inspection_photos
-- -----------------------------------------------------------------------------
CREATE TABLE ins_inspection_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area_recording_id UUID REFERENCES ins_area_recordings(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ins_inspection_photos_area_recording_id ON ins_inspection_photos(area_recording_id);

-- -----------------------------------------------------------------------------
-- ins_followup_responses
-- AI-generated follow-up questions (from transcript gap analysis)
-- -----------------------------------------------------------------------------
CREATE TABLE ins_followup_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID REFERENCES ins_inspections(id) ON DELETE CASCADE,
  apartment_id UUID REFERENCES ins_apartments(id) ON DELETE SET NULL,
  block_type TEXT NOT NULL,                    -- "shared" or "unit"
  questions JSONB DEFAULT '[]',                -- [{ area, question, context }]
  audio_path TEXT,
  transcript TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ins_followup_responses_inspection_id ON ins_followup_responses(inspection_id);

-- -----------------------------------------------------------------------------
-- ins_freestyle_notes
-- -----------------------------------------------------------------------------
CREATE TABLE ins_freestyle_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID REFERENCES ins_inspections(id) ON DELETE CASCADE,
  audio_path TEXT,
  audio_duration_seconds INTEGER,
  transcript TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ins_freestyle_notes_inspection_id ON ins_freestyle_notes(inspection_id);

-- -----------------------------------------------------------------------------
-- STORAGE BUCKETS (create via Supabase dashboard)
-- -----------------------------------------------------------------------------
-- inspection-audio-recordings: private, 50MB max, path: {inspection_id}/{area_id}.webm
-- inspection-photos: private, 10MB max, path: {inspection_id}/{area_id}/{photo_id}.jpg
