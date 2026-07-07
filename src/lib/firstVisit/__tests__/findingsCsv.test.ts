import { describe, it, expect } from 'vitest';
import { buildFindingsCsv, listTypeFor, type FindingRow } from '../findingsCsv';
import { FINDING_RESOLUTION_OPTIONS, RESOLUTION_LIST_TYPE } from '../findingsResolution';
import { ALL_QUESTIONS } from '../questions';

const rows: FindingRow[] = [
  { unit_identifier: 'Apt 3B', item_name: 'Couch', category: 'Furniture',
    location_in_unit: 'Living room', resolution: 'Replace', quantity: 1,
    cost_estimate_eur: 400, urgency: 'Blocks go-live', notes: 'torn',
    media_links: ['https://x/a.jpg', 'https://x/b.mp4'] },
  { unit_identifier: 'Building / common', item_name: 'Hallway paint', category: 'Maintenance',
    location_in_unit: 'Hallway', resolution: 'Fix', quantity: null,
    cost_estimate_eur: 180, urgency: null, notes: null, media_links: [] },
];

describe('buildFindingsCsv', () => {
  it('starts with exactly one UTF-8 BOM (Excel-on-Windows encoding hint)', () => {
    const csv = buildFindingsCsv(rows);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.slice(1).includes('\uFEFF')).toBe(false);
  });
  it('emits the header with a list_type column', () => {
    const lines = buildFindingsCsv(rows).split('\n');
    expect(lines[0]).toBe('\uFEFFunit_identifier,list_type,item_name,category,location_in_unit,resolution,quantity,cost_estimate_eur,urgency,notes,media_links');
  });
  it('derives list_type from resolution', () => {
    expect(listTypeFor('Replace')).toBe('Shopping');
    expect(listTypeFor('Buy')).toBe('Shopping');
    expect(listTypeFor('Fix')).toBe('Renovation');
    expect(listTypeFor('Monitor')).toBe('Ops');
  });
  it('places list_type as the 2nd column per row', () => {
    const lines = buildFindingsCsv(rows).split('\n');
    expect(lines[1].startsWith('Apt 3B,Shopping,')).toBe(true);
    expect(lines[2].startsWith('Building / common,Renovation,')).toBe(true);
  });
  it('joins media links with semicolons', () => {
    expect(buildFindingsCsv(rows)).toContain('https://x/a.jpg;https://x/b.mp4');
  });
  it('quotes cells containing commas, quotes, or newlines', () => {
    const r: FindingRow = { unit_identifier: 'U1', item_name: 'Chair, broken', category: 'Furniture',
      location_in_unit: null, resolution: 'Repair', quantity: null, cost_estimate_eur: null,
      urgency: null, notes: 'he said "ouch"', media_links: [] };
    const csv = buildFindingsCsv([r]);
    expect(csv).toContain('"Chair, broken"');
    expect(csv).toContain('"he said ""ouch"""');
  });
  it('renders null numbers/strings as empty cells', () => {
    const lines = buildFindingsCsv(rows).split('\n');
    // quantity null, urgency null, notes null on row 2
    expect(lines[2]).toBe('Building / common,Renovation,Hallway paint,Maintenance,Hallway,Fix,,180,,,');
  });

  // Drift guard: the resolution picker options and the list-type mapping share
  // one source (findingsResolution.ts). Every picker option must map to a
  // defined list type — none may fall through to the 'Ops' default by accident.
  it('every resolution option has an explicit, non-fallback list type', () => {
    for (const opt of FINDING_RESOLUTION_OPTIONS) {
      expect(
        Object.prototype.hasOwnProperty.call(RESOLUTION_LIST_TYPE, opt),
        `resolution "${opt}" has no explicit list type (would default to Ops)`,
      ).toBe(true);
      expect(listTypeFor(opt)).toBe(RESOLUTION_LIST_TYPE[opt]);
    }
  });

  // The issue_resolution question's options must be exactly the shared list,
  // so the form picker and the CSV mapping can never drift apart.
  it('issue_resolution question options match the shared resolution list', () => {
    const q = ALL_QUESTIONS.find((x) => x.slug === 'issue_resolution');
    expect(q, 'issue_resolution question present').toBeTruthy();
    expect(q!.options).toEqual(FINDING_RESOLUTION_OPTIONS);
  });
});
