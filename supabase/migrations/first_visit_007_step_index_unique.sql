-- First Visit Survey — include step_index in the answers unique index
-- Reference copy — APPLY IN THE HUB (Onboarding_tool) REPO, not here.
-- Run in Onboarding_tool's Supabase project (Studio SQL editor).
-- After applying: NOTIFY pgrst, 'reload schema';
--
-- Repeater rows (issue/item/checkin_step/prop_issue logs) share the same
-- question_key and differ only by step_index, but the unique index from
-- first_visit_005 keyed on (target_id, question_key, area_key) only — so each
-- repeater entry overwrote the previous one on upsert and only the last row
-- survived. Fix: fold step_index into the key. Postgres treats NULLs as
-- distinct in unique indexes, so a nullable step_index would stop deduping
-- non-repeater rows; instead non-repeater rows use the sentinel -1 (the app
-- maps null -> -1 before upserting) and the column becomes NOT NULL.
--
-- DEPLOY ORDER: apply this migration and deploy the matching app change
-- together — the old app version's 3-column onConflict starts erroring the
-- moment the old index is dropped, and the new app version errors until the
-- new index exists. Keep the window short.

UPDATE onboarding.first_visit_answers SET step_index = -1 WHERE step_index IS NULL;

ALTER TABLE onboarding.first_visit_answers
  ALTER COLUMN step_index SET DEFAULT -1;
ALTER TABLE onboarding.first_visit_answers
  ALTER COLUMN step_index SET NOT NULL;

DROP INDEX IF EXISTS onboarding.uq_first_visit_answers_target;
CREATE UNIQUE INDEX IF NOT EXISTS uq_first_visit_answers_target_step
  ON onboarding.first_visit_answers(target_id, question_key, area_key, step_index);
