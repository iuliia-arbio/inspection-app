import { describe, it, expect } from 'vitest';
import { pickCanonicalInspection } from '../canonicalInspection';

const insp = (id: string, status: 'draft' | 'submitted' | 'discarded', started_at: string) =>
  ({ id, status, started_at });

describe('pickCanonicalInspection', () => {
  it('returns undefined for an empty list', () => {
    expect(pickCanonicalInspection([])).toBeUndefined();
  });
  it('prefers submitted over draft regardless of start time', () => {
    expect(
      pickCanonicalInspection([
        insp('a', 'draft', '2026-01-01T00:00:00Z'),
        insp('b', 'submitted', '2026-06-01T00:00:00Z'),
      ])?.id,
    ).toBe('b');
  });
  it('breaks status ties by earliest started_at', () => {
    expect(
      pickCanonicalInspection([
        insp('late', 'draft', '2026-06-02T00:00:00Z'),
        insp('early', 'draft', '2026-06-01T00:00:00Z'),
      ])?.id,
    ).toBe('early');
  });
  it('breaks full ties by lowest id', () => {
    expect(
      pickCanonicalInspection([
        insp('bbb', 'draft', '2026-06-01T00:00:00Z'),
        insp('aaa', 'draft', '2026-06-01T00:00:00Z'),
      ])?.id,
    ).toBe('aaa');
  });
  it('never picks a discarded inspection', () => {
    expect(
      pickCanonicalInspection([
        insp('x', 'discarded', '2026-01-01T00:00:00Z'),
        insp('y', 'draft', '2026-06-01T00:00:00Z'),
      ])?.id,
    ).toBe('y');
    expect(pickCanonicalInspection([insp('x', 'discarded', '2026-01-01T00:00:00Z')])).toBeUndefined();
  });
});
