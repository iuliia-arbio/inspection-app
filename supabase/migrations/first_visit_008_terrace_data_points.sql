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
--   fv_unit_balcony_present  → level 'unit', category 'Unit Profile',
--     subcategory 'Unit identity', format 'Boolean', active, form_types '{}',
--     sources '{}'
--   fv_unit_balconies_count  → same, format 'Number', description NULL.

INSERT INTO onboarding.data_points
  (slug, level, category, subcategory, format, description, active, form_types, sources)
SELECT
  'fv_unit_terrace_present', 'unit', 'Unit Profile', 'Unit identity',
  'Boolean', 'Gate: when "No", terrace count collapses.', true, '{}', '{}'
WHERE NOT EXISTS (
  SELECT 1 FROM onboarding.data_points WHERE slug = 'fv_unit_terrace_present'
);

INSERT INTO onboarding.data_points
  (slug, level, category, subcategory, format, description, active, form_types, sources)
SELECT
  'fv_unit_terraces_count', 'unit', 'Unit Profile', 'Unit identity',
  'Number', NULL, true, '{}', '{}'
WHERE NOT EXISTS (
  SELECT 1 FROM onboarding.data_points WHERE slug = 'fv_unit_terraces_count'
);

-- Post-apply verification: run this and confirm BOTH rows come back with
-- level = 'unit' and active = true. Note the WHERE NOT EXISTS guards above
-- only insert missing rows — they will NOT heal a pre-existing row with
-- wrong values; if a row exists but level/active are off, fix it manually.
SELECT slug, level, active
FROM onboarding.data_points
WHERE slug IN ('fv_unit_terrace_present', 'fv_unit_terraces_count');
