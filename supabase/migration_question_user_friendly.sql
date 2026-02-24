-- =============================================================================
-- MIGRATION: Add user-friendly question info to ins_question_scores
-- question_label: Short display name (e.g. "Kitchen cleanliness")
-- question_text: Full question (e.g. "Is the kitchen clean, hygienic, and guest-ready?")
-- =============================================================================

ALTER TABLE ins_question_scores
  ADD COLUMN IF NOT EXISTS question_label TEXT,
  ADD COLUMN IF NOT EXISTS question_text TEXT;

COMMENT ON COLUMN ins_question_scores.question_label IS 'Short user-friendly name for reports and tables';
COMMENT ON COLUMN ins_question_scores.question_text IS 'Full question text as shown to inspector';
