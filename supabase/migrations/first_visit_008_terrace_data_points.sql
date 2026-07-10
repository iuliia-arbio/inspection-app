-- First Visit Survey — register the terrace question pair in the hub registry
-- Reference copy — APPLY IN THE HUB (Onboarding_tool) REPO, not here.
-- Run in Onboarding_tool's Supabase project (Studio SQL editor).
-- After applying: NOTIFY pgrst, 'reload schema';
--
-- The 2026-07-09 field feedback added a terrace pair to phase 8 "Unit
-- identity" (fv_unit_terrace_present / fv_unit_terraces_count), mirroring the
-- existing balcony pair. The submit route only pushes answers whose slug is
-- registered in onboarding.data_points (unregistered slugs are skipped and
-- reported), so until this migration is applied the two slugs still collect
-- locally and appear in the CSV export but are skipped by submit. Deploy
-- order is therefore safe either way — app-first just skips until applied.
--
-- Registry values mirror the live balcony rows exactly:
--   fv_unit_balcony_present  → label 'Is there a balcony?', level 'unit',
--     category 'Unit Profile', subcategory 'Unit identity', format 'Boolean',
--     active, form_types '{}', sources '{}'
--   fv_unit_balconies_count  → label 'Number of balconies', same, format
--     'Number', description NULL.
-- label is NOT NULL on onboarding.data_points — first apply attempt failed
-- on 23502 because the column was omitted.

INSERT INTO onboarding.data_points
  (slug, label, level, category, subcategory, format, description, active, form_types, sources)
SELECT
  'fv_unit_terrace_present', 'Is there a terrace?', 'unit', 'Unit Profile',
  'Unit identity', 'Boolean', 'Gate: when "No", terrace count collapses.',
  true, '{}', '{}'
WHERE NOT EXISTS (
  SELECT 1 FROM onboarding.data_points WHERE slug = 'fv_unit_terrace_present'
);

INSERT INTO onboarding.data_points
  (slug, label, level, category, subcategory, format, description, active, form_types, sources)
SELECT
  'fv_unit_terraces_count', 'Number of terraces', 'unit', 'Unit Profile',
  'Unit identity', 'Number', NULL, true, '{}', '{}'
WHERE NOT EXISTS (
  SELECT 1 FROM onboarding.data_points WHERE slug = 'fv_unit_terraces_count'
);

-- Post-apply verification: run this and confirm BOTH rows come back with
-- level = 'unit' and active = true. Note the WHERE NOT EXISTS guards above
-- only insert missing rows — they will NOT heal a pre-existing row with
-- wrong values; if a row exists but level/active are off, fix it manually.
SELECT slug, label, level, active
FROM onboarding.data_points
WHERE slug IN ('fv_unit_terrace_present', 'fv_unit_terraces_count');
