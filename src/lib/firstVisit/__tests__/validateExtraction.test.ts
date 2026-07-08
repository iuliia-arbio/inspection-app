import { describe, it, expect } from 'vitest';
import { validateExtraction } from '../validateExtraction';

const TARGET = [
  'fv_location_quality',
  'issue_name',
  'issue_type',
  'issue_cost_estimate_eur',
];

describe('validateExtraction', () => {
  it('keeps a valid single value and clamps confidence', () => {
    const r = validateExtraction(
      { singles: { fv_location_quality: { value: 'Good', confidence: 1.5 } }, items: [] },
      TARGET,
    );
    expect(r.singles.fv_location_quality.value).toBe('Good');
    expect(r.singles.fv_location_quality.confidence).toBe(1);
  });

  it('nulls an off-enum value and records a warning', () => {
    const r = validateExtraction(
      { singles: { fv_location_quality: { value: 'Fabulous', confidence: 0.9 } }, items: [] },
      TARGET,
    );
    expect(r.singles.fv_location_quality.value).toBeNull();
    expect(r.warnings.some((w) => w.includes('fv_location_quality'))).toBe(true);
  });

  it('keeps a valid repeater item and coerces a numeric cost', () => {
    const r = validateExtraction(
      {
        singles: {},
        items: [
          {
            group_id: 'issue',
            fields: {
              issue_name: { value: 'Broken oven', confidence: 0.9 },
              issue_type: { value: 'Equipment', confidence: 0.8 },
              issue_cost_estimate_eur: { value: '200', confidence: 0.5 },
            },
          },
        ],
      },
      TARGET,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].fields.issue_cost_estimate_eur.value).toBe(200);
    expect(r.items[0].fields.issue_type.value).toBe('Equipment');
  });

  it('drops an item missing its required name', () => {
    const r = validateExtraction(
      {
        singles: {},
        items: [
          { group_id: 'issue', fields: { issue_type: { value: 'Equipment', confidence: 0.8 } } },
        ],
      },
      TARGET,
    );
    expect(r.items).toHaveLength(0);
  });

  it('drops an item with an unknown group', () => {
    const r = validateExtraction(
      { singles: {}, items: [{ group_id: 'nope', fields: {} }] },
      TARGET,
    );
    expect(r.items).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes('unknown group'))).toBe(true);
  });

  it('keeps a trimmed summary string', () => {
    const r = validateExtraction(
      { singles: {}, items: [], summary: '  Quiet street, well kept.  ' },
      TARGET,
    );
    expect(r.summary).toBe('Quiet street, well kept.');
  });

  it('nulls a missing, empty, or non-string summary', () => {
    expect(validateExtraction({ singles: {}, items: [] }, TARGET).summary).toBeNull();
    expect(validateExtraction({ singles: {}, items: [], summary: '   ' }, TARGET).summary).toBeNull();
    expect(validateExtraction({ singles: {}, items: [], summary: 42 }, TARGET).summary).toBeNull();
  });

  it('caps an over-long summary at 1500 chars', () => {
    const r = validateExtraction(
      { singles: {}, items: [], summary: 'x'.repeat(5000) },
      TARGET,
    );
    expect(r.summary).toHaveLength(1500);
  });
});

describe('validateExtraction — custom multi-select options', () => {
  // fv_building_amenities_verify is a multi-select with allow_custom_options.
  it('keeps off-list values for an allow_custom_options multi-select', () => {
    const r = validateExtraction(
      {
        singles: {
          fv_building_amenities_verify: { value: ['Sauna', 'Bike room'], confidence: 0.8 },
        },
        items: [],
      },
      ['fv_building_amenities_verify'],
    );
    expect(r.singles.fv_building_amenities_verify.value).toEqual(['Sauna', 'Bike room']);
  });

  it('still drops off-list values for a normal (non-custom) multi-select', () => {
    // fv_neighbourhood_vibe_tags is multi but NOT allow_custom_options.
    const r = validateExtraction(
      {
        singles: { fv_neighbourhood_vibe_tags: { value: ['totally-made-up'], confidence: 0.5 } },
        items: [],
      },
      ['fv_neighbourhood_vibe_tags'],
    );
    expect(r.singles.fv_neighbourhood_vibe_tags?.value ?? null).toBeNull();
  });

  it('drops the exclusive option when AI extraction returns both "None" and a real value', () => {
    const r = validateExtraction(
      {
        singles: {
          fv_building_amenities_verify: { value: ['None', 'Pool'], confidence: 0.8 },
        },
        items: [],
      },
      ['fv_building_amenities_verify'],
    );
    expect(r.singles.fv_building_amenities_verify.value).toEqual(['Pool']);
    expect(
      r.warnings.some((w) => w.includes('fv_building_amenities_verify')),
    ).toBe(true);
  });
});
