import { describe, it, expect } from 'vitest';
import { areaKey, resolveResumePosition } from '../inspection';
import type { InspectionBlock } from '../types';

// Two units after the shared block, each with the SAME area ids — the shape that
// made unit B's bathroom overwrite unit A's before areas were unit-qualified.
const BLOCKS: InspectionBlock[] = [
  {
    type: 'shared',
    unitId: null,
    unitName: 'Shared Areas',
    areas: [
      { id: 'exterior', name: 'Exterior & Building Access', scope: 'shared' },
      { id: 'common', name: 'Common Areas', scope: 'shared' },
    ],
    issues: [],
  },
  {
    type: 'unit',
    unitId: 'apt-a',
    unitName: 'Unit A101',
    areas: [
      { id: 'entrance', name: 'Entrance & Hallway', scope: 'unit' },
      { id: 'bathroom_1', name: 'Bathroom', scope: 'unit' },
    ],
    issues: [],
  },
  {
    type: 'unit',
    unitId: 'apt-b',
    unitName: 'Unit A102',
    areas: [
      { id: 'entrance', name: 'Entrance & Hallway', scope: 'unit' },
      { id: 'bathroom_1', name: 'Bathroom', scope: 'unit' },
    ],
    issues: [],
  },
];

const shared = (area_id: string) => ({ area_id, apartment_id: null, scope: 'shared' });
const unit = (apartment_id: string, area_id: string) => ({ area_id, apartment_id, scope: 'unit' });

describe('areaKey', () => {
  it('separates the same area id across units', () => {
    expect(areaKey('apt-a', 'bathroom_1')).not.toBe(areaKey('apt-b', 'bathroom_1'));
  });

  it('treats a missing apartment as the shared block', () => {
    expect(areaKey(null, 'exterior')).toBe(areaKey(undefined, 'exterior'));
  });
});

describe('resolveResumePosition', () => {
  it('starts at the top when nothing is saved', () => {
    expect(resolveResumePosition(BLOCKS, [])).toEqual({ kind: 'fresh' });
  });

  it('resumes at the first area with nothing stored', () => {
    const saved = [shared('exterior'), shared('common'), unit('apt-a', 'entrance')];
    expect(resolveResumePosition(BLOCKS, saved)).toEqual({
      kind: 'area',
      blockIndex: 1,
      areaIndex: 1,
    });
  });

  it('does not credit unit B for the area unit A saved', () => {
    // Everything except unit B's bathroom — the reported failure case: the visit
    // died on a bathroom screen and reopening must land there, not at area 1.
    const saved = [
      shared('exterior'),
      shared('common'),
      unit('apt-a', 'entrance'),
      unit('apt-a', 'bathroom_1'),
      unit('apt-b', 'entrance'),
    ];
    expect(resolveResumePosition(BLOCKS, saved)).toEqual({
      kind: 'area',
      blockIndex: 2,
      areaIndex: 1,
    });
  });

  it('fills a gap left behind before moving on', () => {
    // The inspector skipped Common Areas and kept going: resume returns to the
    // gap rather than to the furthest point reached.
    const saved = [shared('exterior'), unit('apt-a', 'entrance')];
    expect(resolveResumePosition(BLOCKS, saved)).toEqual({
      kind: 'area',
      blockIndex: 0,
      areaIndex: 1,
    });
  });

  it('lands on the last block’s follow-up screen when every area is stored', () => {
    const saved = BLOCKS.flatMap((b) =>
      b.areas.map((a) =>
        b.unitId ? unit(b.unitId, a.id) : shared(a.id)
      )
    );
    expect(resolveResumePosition(BLOCKS, saved)).toEqual({
      kind: 'followup',
      blockIndex: 2,
      areaIndex: 1,
    });
  });

  it('ignores freestyle notes, which belong to no area', () => {
    const saved = [
      { area_id: 'freestyle_deal_abc', apartment_id: null, scope: 'freestyle' },
      { area_id: 'freestyle_unit_def', apartment_id: 'apt-a', scope: 'freestyle' },
    ];
    expect(resolveResumePosition(BLOCKS, saved)).toEqual({ kind: 'fresh' });
  });

  it('treats an empty flow as fresh rather than indexing past the end', () => {
    expect(resolveResumePosition([], [shared('exterior')])).toEqual({ kind: 'fresh' });
  });
});
