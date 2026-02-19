-- =============================================================================
-- OPTIONAL: Seed test data for development
-- Run this after schema.sql if you want sample deals before n8n pushes real data
-- =============================================================================

-- Deal 1 with apartments
INSERT INTO ins_deals (id, deal_sku, notion_page_id, focus_areas) VALUES
(
  'a0000001-0001-0001-0001-000000000001',
  'DE_BER_014_Apartmently_019',
  'mock_deal_1',
  '[
    {"category": "check-in", "issues": ["Access Complication (Digital Keys/App)", "Unclear Check-in/Check-out Instructions"]},
    {"category": "cleanliness", "issues": ["General Cleanliness (Dust, Dirt, Stains, mold)", "Poor Building Condition"]},
    {"category": "accuracy", "issues": ["Room/Amenities Not As Pictured/Described"]}
  ]'::jsonb
) ON CONFLICT (deal_sku) DO UPDATE SET
  notion_page_id = EXCLUDED.notion_page_id,
  focus_areas = EXCLUDED.focus_areas;

INSERT INTO ins_apartments (deal_sku, notion_page_id, apartment_sku, issues) VALUES
('DE_BER_014_Apartmently_019', 'mock_apt_101', 'A101', ARRAY['Old dust bunnies on floor in stairwell and entrance (1 mentions, 12.5%)', 'Marks on the walls (1 mentions, 12.5%)']),
('DE_BER_014_Apartmently_019', 'mock_apt_102', 'A102', ARRAY['Long hairs from previous guests in shower (1 mentions, 12.5%)', 'Some furniture slightly damaged (1 mentions, 12.5%)']),
('DE_BER_014_Apartmently_019', 'mock_apt_103', 'A103', ARRAY['Leaky window in room (left side)', 'Mold in bathroom grout', 'Wi-Fi not working (2 mentions, 25%)']),
('DE_BER_014_Apartmently_019', 'mock_apt_104', 'A104', '{}'),
('DE_BER_014_Apartmently_019', 'mock_apt_105', 'A105', ARRAY['Stove not heating properly', 'Dirty towels (1 mentions, 12.5%)'])
ON CONFLICT (notion_page_id) DO NOTHING;

-- Deal 2 with apartments
INSERT INTO ins_deals (id, deal_sku, notion_page_id, focus_areas) VALUES
(
  'a0000001-0001-0001-0001-000000000002',
  'DE_BER_015_Apartmently_020',
  'mock_deal_2',
  '[{"category": "cleanliness", "issues": ["General Cleanliness"]}]'::jsonb
) ON CONFLICT (deal_sku) DO UPDATE SET
  notion_page_id = EXCLUDED.notion_page_id,
  focus_areas = EXCLUDED.focus_areas;

INSERT INTO ins_apartments (deal_sku, notion_page_id, apartment_sku, issues) VALUES
('DE_BER_015_Apartmently_020', 'mock_apt_201', 'B201', '{}'),
('DE_BER_015_Apartmently_020', 'mock_apt_202', 'B202', ARRAY['Broken door handle (1 mentions, 12.5%)'])
ON CONFLICT (notion_page_id) DO NOTHING;
