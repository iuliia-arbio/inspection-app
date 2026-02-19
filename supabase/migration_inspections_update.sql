-- =============================================================================
-- MIGRATION: Allow anon to UPDATE ins_inspections (for completing inspection)
-- =============================================================================

DROP POLICY IF EXISTS "Allow anon update ins_inspections" ON ins_inspections;
CREATE POLICY "Allow anon update ins_inspections" ON ins_inspections
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
