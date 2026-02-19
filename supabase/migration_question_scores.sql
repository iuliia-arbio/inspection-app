-- =============================================================================
-- MIGRATION: ins_question_scores + question_id on photos
-- Per-question AI scores (1-10) and details; photos linked to questions
-- =============================================================================

-- ins_question_scores: one row per question per area_recording
CREATE TABLE ins_question_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area_recording_id UUID REFERENCES ins_area_recordings(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,                    -- e.g. "ext_checkin", "kit_clean"
  score INTEGER CHECK (score >= 1 AND score <= 10),  -- 1-10, AI-derived
  details TEXT,                                 -- AI-extracted or from follow-up
  follow_up_question TEXT,                      -- AI-generated if score/details missing
  follow_up_answer TEXT,                        -- From user voice response
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(area_recording_id, question_id)
);

CREATE INDEX idx_ins_question_scores_area_recording ON ins_question_scores(area_recording_id);

-- Link photos to specific questions (nullable = area-level photo if not specified)
ALTER TABLE ins_inspection_photos ADD COLUMN IF NOT EXISTS question_id TEXT;

-- RLS for ins_question_scores
ALTER TABLE ins_question_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon insert ins_question_scores" ON ins_question_scores;
CREATE POLICY "Allow anon insert ins_question_scores" ON ins_question_scores
  FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Allow anon select ins_question_scores" ON ins_question_scores;
CREATE POLICY "Allow anon select ins_question_scores" ON ins_question_scores
  FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Allow anon update ins_question_scores" ON ins_question_scores;
CREATE POLICY "Allow anon update ins_question_scores" ON ins_question_scores
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
