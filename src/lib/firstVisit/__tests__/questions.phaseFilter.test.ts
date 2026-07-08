import { describe, it, expect } from 'vitest';
import { phasesForScope } from '../questions';

describe('phasesForScope phase filter', () => {
  it('returns all deal phases when no filter is given (regression)', () => {
    // Deal scope now has only a single phase: '1' (Visit metadata).
    const all = phasesForScope('deal');
    expect(all.map((p) => p.id)).toEqual(['1']);
  });

  it("['1'] returns only visit metadata", () => {
    const filtered = phasesForScope('deal', ['1']);
    expect(filtered.map((p) => p.id)).toEqual(['1']);
    const slugs = filtered.flatMap((p) => p.questions.map((q) => q.slug));
    expect(slugs).toContain('fv_visit_date');
    expect(slugs).not.toContain('fv_readiness_health_score');
  });

  it("['15'] returns only the final assessment (unit_category)", () => {
    const filtered = phasesForScope('unit_category', ['15']);
    expect(filtered.map((p) => p.id)).toEqual(['15']);
    const slugs = filtered.flatMap((p) => p.questions.map((q) => q.slug));
    expect(slugs).toContain('fv_readiness_health_score');
    expect(slugs).not.toContain('fv_unit_floor_number');
  });

  it('two filtered unit_category subsets partition the unfiltered set exactly', () => {
    const all = phasesForScope('unit_category').flatMap((p) =>
      p.questions.map((q) => q.slug),
    );
    const a = phasesForScope('unit_category', ['7', '8', '9', '11', '18']).flatMap((p) =>
      p.questions.map((q) => q.slug),
    );
    const b = phasesForScope('unit_category', ['12', '13', '14', '17', '15']).flatMap((p) =>
      p.questions.map((q) => q.slug),
    );
    expect([...a, ...b].sort()).toEqual([...all].sort());
  });

  it('an empty filter returns no phases (explicit empty, not "all")', () => {
    expect(phasesForScope('deal', [])).toEqual([]);
  });

  it('does not affect other scopes when no filter is given', () => {
    expect(phasesForScope('location').length).toBeGreaterThan(0);
    expect(phasesForScope('unit_category').length).toBeGreaterThan(0);
  });
});
