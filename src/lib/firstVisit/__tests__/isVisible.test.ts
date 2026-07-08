import { describe, it, expect } from 'vitest';
import { isVisible, type VisibleWhen } from '../questions';

const m = (entries: Array<[string, unknown]>) => new Map<string, unknown>(entries);

describe('isVisible — conditional branching predicate', () => {
  it('no rule → always visible', () => {
    expect(isVisible(undefined, m([]))).toBe(true);
  });

  describe('equals (hidden until controller matches)', () => {
    const rule: VisibleWhen = { question: 'gate', equals: true };
    it('hidden when controller unanswered', () => {
      expect(isVisible(rule, m([]))).toBe(false);
    });
    it('hidden when controller mismatches', () => {
      expect(isVisible(rule, m([['gate', false]]))).toBe(false);
    });
    it('visible when controller matches (strict)', () => {
      expect(isVisible(rule, m([['gate', true]]))).toBe(true);
    });
    it('string equals matches by identity', () => {
      const r: VisibleWhen = { question: 'g', equals: 'Yes' };
      expect(isVisible(r, m([['g', 'Yes']]))).toBe(true);
      expect(isVisible(r, m([['g', 'No']]))).toBe(false);
    });
  });

  describe('not_equals (visible until excluded)', () => {
    const rule: VisibleWhen = { question: 'parking', not_equals: 'None' };
    it('visible when controller unanswered', () => {
      expect(isVisible(rule, m([]))).toBe(true);
    });
    it('hidden only when controller equals the excluded value', () => {
      expect(isVisible(rule, m([['parking', 'None']]))).toBe(false);
    });
    it('visible for any other value', () => {
      expect(isVisible(rule, m([['parking', 'Garage on-site']]))).toBe(true);
    });
  });

  describe('in / not_in', () => {
    it('in → visible only when answer is in the list', () => {
      const r: VisibleWhen = { question: 'g', in: ['A', 'B'] };
      expect(isVisible(r, m([['g', 'A']]))).toBe(true);
      expect(isVisible(r, m([['g', 'C']]))).toBe(false);
      expect(isVisible(r, m([]))).toBe(false);
    });
    it('not_in → hidden only when answer is in the excluded list', () => {
      const r: VisibleWhen = { question: 'g', not_in: ['None'] };
      expect(isVisible(r, m([['g', 'None']]))).toBe(false);
      expect(isVisible(r, m([['g', 'Other']]))).toBe(true);
      expect(isVisible(r, m([]))).toBe(true);
    });
    it('hides lock detail fields when access has no lock (Ring To Open)', () => {
      const r: VisibleWhen = { question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] };
      expect(isVisible(r, m([['fv_step_lock_type', 'Ring To Open']]))).toBe(false);
    });
    it('shows lock detail fields when access uses a real lock (Smart Lock)', () => {
      const r: VisibleWhen = { question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] };
      expect(isVisible(r, m([['fv_step_lock_type', 'Smart Lock']]))).toBe(true);
    });
  });

  describe('multi-select controllers (array answers)', () => {
    it('equals matches when any selected option matches', () => {
      const r: VisibleWhen = { question: 'tags', equals: 'Pool' };
      expect(isVisible(r, m([['tags', ['Sauna', 'Pool']]]))).toBe(true);
      expect(isVisible(r, m([['tags', ['Sauna']]]))).toBe(false);
    });
    it('not_in hidden when any selected option is excluded', () => {
      const r: VisibleWhen = { question: 'tags', not_in: ['None'] };
      expect(isVisible(r, m([['tags', ['None']]]))).toBe(false);
      expect(isVisible(r, m([['tags', ['Pool']]]))).toBe(true);
    });
  });
});
