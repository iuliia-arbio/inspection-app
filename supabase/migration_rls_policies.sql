-- =============================================================================
-- RLS POLICIES: Allow anon to insert/select for inspection app
-- Run this if recordings and photos are not saving (RLS blocks by default)
-- =============================================================================

-- ins_deals and ins_apartments: allow anon to read (for deal list)
ALTER TABLE ins_deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon select ins_deals" ON ins_deals;
CREATE POLICY "Allow anon select ins_deals" ON ins_deals
  FOR SELECT TO anon USING (true);

ALTER TABLE ins_apartments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon select ins_apartments" ON ins_apartments;
CREATE POLICY "Allow anon select ins_apartments" ON ins_apartments
  FOR SELECT TO anon USING (true);

-- ins_inspections
ALTER TABLE ins_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon insert ins_inspections" ON ins_inspections;
CREATE POLICY "Allow anon insert ins_inspections" ON ins_inspections
  FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Allow anon select ins_inspections" ON ins_inspections;
CREATE POLICY "Allow anon select ins_inspections" ON ins_inspections
  FOR SELECT TO anon USING (true);

-- ins_area_recordings (UPDATE needed for transcription results)
ALTER TABLE ins_area_recordings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon insert ins_area_recordings" ON ins_area_recordings;
CREATE POLICY "Allow anon insert ins_area_recordings" ON ins_area_recordings
  FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Allow anon select ins_area_recordings" ON ins_area_recordings;
CREATE POLICY "Allow anon select ins_area_recordings" ON ins_area_recordings
  FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Allow anon update ins_area_recordings" ON ins_area_recordings;
CREATE POLICY "Allow anon update ins_area_recordings" ON ins_area_recordings
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ins_inspection_photos
ALTER TABLE ins_inspection_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon insert ins_inspection_photos" ON ins_inspection_photos;
CREATE POLICY "Allow anon insert ins_inspection_photos" ON ins_inspection_photos
  FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Allow anon select ins_inspection_photos" ON ins_inspection_photos;
CREATE POLICY "Allow anon select ins_inspection_photos" ON ins_inspection_photos
  FOR SELECT TO anon USING (true);

-- Storage: allow anon to upload to inspection buckets
DROP POLICY IF EXISTS "Allow anon insert inspection-audio-recordings" ON storage.objects;
CREATE POLICY "Allow anon insert inspection-audio-recordings"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'inspection-audio-recordings');

DROP POLICY IF EXISTS "Allow anon select inspection-audio-recordings" ON storage.objects;
CREATE POLICY "Allow anon select inspection-audio-recordings"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'inspection-audio-recordings');

DROP POLICY IF EXISTS "Allow anon insert inspection-photos" ON storage.objects;
CREATE POLICY "Allow anon insert inspection-photos"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'inspection-photos');

DROP POLICY IF EXISTS "Allow anon select inspection-photos" ON storage.objects;
CREATE POLICY "Allow anon select inspection-photos"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'inspection-photos');

-- For audio upsert (overwrite): allow anon to update existing objects
DROP POLICY IF EXISTS "Allow anon update inspection-audio-recordings" ON storage.objects;
CREATE POLICY "Allow anon update inspection-audio-recordings"
  ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'inspection-audio-recordings');
