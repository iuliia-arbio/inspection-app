import { describe, it, expect } from 'vitest';
import { computeProgressFromAnswers, remainingRequiredForTarget } from '../progress';
import { questionsForScope, isScopeLevelRequired } from '../questions';
import type { FirstVisitPhase, FirstVisitQuestion } from '../questions';
import type { LocalAnswer } from '../db';
import type { HubScope } from '../resolveScope';

function makeAnswer(
  question_key: string,
  value: unknown,
  overrides: Partial<LocalAnswer> = {},
): LocalAnswer {
  return {
    id: `a-${question_key}`,
    inspection_id: 'i1',
    target_id: 't1',
    scope: 'location',
    question_key,
    area_key: 'default',
    value,
    was_prefilled: false,
    was_accepted_as_is: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function requiredSlugs(scope: HubScope): string[] {
  // Scope-level required = required AND not a repeater member (mirrors the
  // production denominator in computeProgressFromAnswers).
  return questionsForScope(scope)
    .filter(isScopeLevelRequired)
    .map((q) => q.slug);
}

describe('computeProgressFromAnswers', () => {
  it('total reflects required-only count for each scope', () => {
    for (const scope of ['deal', 'location', 'unit_category'] as const) {
      const total = requiredSlugs(scope).length;
      const { done, total: t } = computeProgressFromAnswers(scope, []);
      expect(t).toBe(total);
      expect(done).toBe(0);
    }
  });

  it('returns done=0 with empty answers list', () => {
    const { done } = computeProgressFromAnswers('deal', []);
    expect(done).toBe(0);
  });

  it('ignores answers for unrelated question keys', () => {
    const answers = [
      makeAnswer('not_a_real_question_slug', 'something'),
      makeAnswer('also_fake', 42),
    ];
    const { done } = computeProgressFromAnswers('location', answers);
    expect(done).toBe(0);
  });

  it('counts a single answered required question as done=1', () => {
    const [first] = requiredSlugs('deal');
    const { done } = computeProgressFromAnswers('deal', [
      makeAnswer(first, 'Some Deal'),
    ]);
    expect(done).toBe(1);
  });

  it('counts the skip sentinel as terminal (done increments)', () => {
    const [first] = requiredSlugs('deal');
    const { done } = computeProgressFromAnswers('deal', [
      makeAnswer(first, { __skipped: true, reason: 'Owner absent' }),
    ]);
    expect(done).toBe(1);
  });

  it('does NOT count empty-string answers as done', () => {
    const [first] = requiredSlugs('deal');
    const { done } = computeProgressFromAnswers('deal', [
      makeAnswer(first, ''),
    ]);
    expect(done).toBe(0);
  });

  it('does NOT count optional questions toward progress', () => {
    // Pick an optional question for the location scope and answer it; done must stay 0.
    const optional = questionsForScope('location').find((q) => !q.required);
    expect(optional, 'expected at least one optional location question in config').toBeTruthy();
    const { done } = computeProgressFromAnswers('location', [
      makeAnswer(optional!.slug, 'hello'),
    ]);
    expect(done).toBe(0);
  });

  it('mixes required + optional correctly — only required hits the counter', () => {
    const reqs = requiredSlugs('location');
    const optional = questionsForScope('location').find((q) => !q.required);
    const answers = [
      makeAnswer(reqs[0], 'A'),
      makeAnswer(reqs[1], 'B'),
      makeAnswer(optional!.slug, 'noise'),
    ];
    const { done, total } = computeProgressFromAnswers('location', answers);
    expect(done).toBe(2);
    expect(total).toBe(reqs.length);
  });

  it('treats different scopes independently — location vs unit_category totals differ', () => {
    const loc = computeProgressFromAnswers('location', []);
    const uc = computeProgressFromAnswers('unit_category', []);
    expect(loc.total).toBe(requiredSlugs('location').length);
    expect(uc.total).toBe(requiredSlugs('unit_category').length);
    // From the current config they should not match — guards against a regression
    // that conflates the two scopes.
    expect(loc.total).not.toBe(uc.total);
  });

  it('asking for unit_category scope ignores answers for location-scoped required slugs', () => {
    // location-scoped slug answered, but we ask for unit_category progress
    const locReq = requiredSlugs('location')[0];
    const { done } = computeProgressFromAnswers('unit_category', [
      makeAnswer(locReq, 'ignored'),
    ]);
    expect(done).toBe(0);
  });

  it('does NOT count repeater-group (group_id) members toward scope-level required', () => {
    // Findings are a block-repeater: 5 of their fields are required:true but
    // carry group_id:'finding'. A scope with zero findings blocks is valid, so
    // these must NOT inflate the scope-level required denominator. The
    // unit_category scope includes the findings repeater; none of its required
    // slugs should be a group_id question.
    const uc = questionsForScope('unit_category');
    const repeaterRequired = uc.filter((q) => q.required && q.group_id);
    // Sanity: the config actually contains required repeater members, otherwise
    // this test proves nothing.
    expect(repeaterRequired.length).toBeGreaterThan(0);

    const scopeRequired = requiredSlugs('unit_category');
    for (const q of repeaterRequired) {
      expect(
        scopeRequired.includes(q.slug),
        `${q.slug} is a repeater member and must not be a scope-level required question`,
      ).toBe(false);
    }

    // And the total denominator must exclude every repeater member.
    const { total } = computeProgressFromAnswers('unit_category', []);
    const nonRepeaterRequired = uc.filter((q) => q.required && !q.group_id).length;
    expect(total).toBe(nonRepeaterRequired);
  });
});

describe('computeProgressFromAnswers phase filter', () => {
  it('filtered unit_category progress for two phase subsets sums to the unfiltered total', () => {
    // unit_category spans phases 7,8,9,11,12,13,14,17,15 (7 = WiFi, relocated
    // from location; 10 was split into 11 (condition) and 17 (issue log)).
    // Splitting them into two disjoint subsets and filtering each must add
    // back up to the unfiltered scope total.
    const whole = computeProgressFromAnswers('unit_category', []);
    const firstHalf = computeProgressFromAnswers('unit_category', [], ['7', '8', '9', '11']);
    const secondHalf = computeProgressFromAnswers('unit_category', [], ['12', '13', '14', '17', '15']);
    expect(firstHalf.total + secondHalf.total).toBe(whole.total);
    expect(firstHalf.total).toBeGreaterThan(0);
    expect(secondHalf.total).toBeGreaterThan(0);
  });

  it('counts against an injected phases set, not the global config', () => {
    // A tiny custom survey: one phase, one location-scoped required single
    // question. The slug does not exist in the bundled config, so if the global
    // PHASES were used the total/done would not reflect this set.
    const customQ: FirstVisitQuestion = {
      slug: 'custom_only_field',
      label: 'Custom only field',
      description: null,
      scope: 'location',
      mode: 'observe',
      type: 'text',
      options: [],
      required: true,
      repeater: false,
      pms_target: null,
      status: 'existing',
      verdict: null,
      notes: null,
      phase_id: 'custom_phase',
      phase_label: 'Custom phase',
    };
    const customPhases: FirstVisitPhase[] = [
      { id: 'custom_phase', label: 'Custom phase', questions: [customQ] },
    ];

    // Total reflects exactly the one required question in the injected set.
    const empty = computeProgressFromAnswers('location', [], undefined, customPhases);
    expect(empty.total).toBe(1);
    expect(empty.done).toBe(0);

    // Answering it counts toward the injected denominator.
    const filled = computeProgressFromAnswers(
      'location',
      [makeAnswer('custom_only_field', 'hello')],
      undefined,
      customPhases,
    );
    expect(filled.done).toBe(1);

    // A real global location slug is NOT part of the injected set, so it never
    // counts — proving we measured against the custom phases, not PHASES.
    const globalSlug = requiredSlugs('location')[0];
    const withGlobalAnswer = computeProgressFromAnswers(
      'location',
      [makeAnswer(globalSlug, 'x')],
      undefined,
      customPhases,
    );
    expect(withGlobalAnswer.total).toBe(1);
    expect(withGlobalAnswer.done).toBe(0);
  });

  it('an answer only counts toward the card that contains its question', () => {
    // fv_readiness_health_score lives in the unit_category "Final assessment"
    // phase '15'. It must not count toward an unrelated phase card ('8'), only
    // toward the card whose filter includes its phase ('15').
    const identity = computeProgressFromAnswers(
      'unit_category',
      [makeAnswer('fv_readiness_health_score', '7', { scope: 'unit_category' })],
      ['8'],
    );
    const finalAssessment = computeProgressFromAnswers(
      'unit_category',
      [makeAnswer('fv_readiness_health_score', '7', { scope: 'unit_category' })],
      ['15'],
    );
    expect(identity.done).toBe(0);
    expect(finalAssessment.done).toBe(1);
  });

  it('excludes required questions hidden by a visible_when gate from the denominator', () => {
    const base = {
      label: '',
      description: null,
      scope: 'location' as HubScope,
      mode: 'data' as const,
      type: 'text' as const,
      options: [],
      repeater: false,
      pms_target: null,
      status: 'existing' as const,
      verdict: null,
      notes: null,
      phase_id: 'p',
      phase_label: 'P',
    };
    const gate: FirstVisitQuestion = { ...base, slug: 'gate', type: 'boolean', required: false };
    const dependent: FirstVisitQuestion = {
      ...base,
      slug: 'dep',
      required: true,
      visible_when: { question: 'gate', equals: true },
    };
    const phases: FirstVisitPhase[] = [
      { id: 'p', label: 'P', questions: [gate, dependent] },
    ];

    // Gate unanswered → dependent hidden → not counted (total 0).
    expect(computeProgressFromAnswers('location', [], undefined, phases).total).toBe(0);

    // Gate = false → still hidden → not counted.
    const off = computeProgressFromAnswers(
      'location',
      [makeAnswer('gate', false)],
      undefined,
      phases,
    );
    expect(off.total).toBe(0);

    // Gate = true → dependent visible → counted, and answering it completes it.
    const onEmpty = computeProgressFromAnswers(
      'location',
      [makeAnswer('gate', true)],
      undefined,
      phases,
    );
    expect(onEmpty.total).toBe(1);
    expect(onEmpty.done).toBe(0);

    const onFilled = computeProgressFromAnswers(
      'location',
      [makeAnswer('gate', true), makeAnswer('dep', 'answered')],
      undefined,
      phases,
    );
    expect(onFilled.total).toBe(1);
    expect(onFilled.done).toBe(1);
  });
});

describe('media-answered file questions (mediaKeys)', () => {
  // Photo/video capture writes only the media table — no answer row exists —
  // so progress must accept a set of media-answered question keys or required
  // file questions can never count as done (rings stuck short of 100%).
  const base = {
    label: '',
    description: null,
    scope: 'location' as HubScope,
    mode: 'observe' as const,
    options: [],
    required: true,
    repeater: false,
    pms_target: null,
    status: 'existing' as const,
    verdict: null,
    notes: null,
    phase_id: 'p',
    phase_label: 'P',
  };
  const fileQ: FirstVisitQuestion = { ...base, slug: 'photo_q', type: 'file' };
  const textQ: FirstVisitQuestion = { ...base, slug: 'text_q', type: 'text' };
  const phases: FirstVisitPhase[] = [
    { id: 'p', label: 'P', questions: [fileQ, textQ] },
  ];

  it('counts a required file question as done when its key is in mediaKeys', () => {
    const p = computeProgressFromAnswers(
      'location', [], undefined, phases, new Set(['photo_q']),
    );
    expect(p.total).toBe(2);
    expect(p.done).toBe(1);
  });

  it('leaves a required file question missing without a media key', () => {
    const p = computeProgressFromAnswers('location', [], undefined, phases);
    expect(p.total).toBe(2);
    expect(p.done).toBe(0);
    const withUnrelated = computeProgressFromAnswers(
      'location', [], undefined, phases, new Set(['some_other_q']),
    );
    expect(withUnrelated.done).toBe(0);
  });

  it('a skip-marker answer keeps a file question done with EMPTY mediaKeys', () => {
    // Precedence guard: the answered-value check (skip markers count — the
    // inspector dealt with the question) must run for file questions too. A
    // refactor to "file ? media-only : value-only" would break skipped photos.
    const answers = [
      makeAnswer('photo_q', { __skipped: true, reason: 'No access' }),
    ];
    const p = computeProgressFromAnswers(
      'location', answers, undefined, phases, new Set<string>(),
    );
    expect(p.total).toBe(2);
    expect(p.done).toBe(1);
    // And the submit dialog's remaining list agrees.
    const remaining = remainingRequiredForTarget({
      label: 'Prop',
      scope: 'location' as HubScope,
      answers,
      phases,
      mediaKeys: new Set<string>(),
    });
    expect(remaining.map((q) => q.slug)).not.toContain('photo_q');
  });

  it('does NOT let a media key satisfy a non-file required question', () => {
    const p = computeProgressFromAnswers(
      'location', [], undefined, phases, new Set(['text_q']),
    );
    expect(p.done).toBe(0);
  });

  it('excludes a hidden required file question regardless of mediaKeys', () => {
    const gate: FirstVisitQuestion = {
      ...base, slug: 'gate', type: 'boolean', required: false,
    };
    const gatedFile: FirstVisitQuestion = {
      ...fileQ,
      slug: 'gated_photo',
      visible_when: { question: 'gate', equals: true },
    };
    const gatedPhases: FirstVisitPhase[] = [
      { id: 'p', label: 'P', questions: [gate, gatedFile] },
    ];
    const hidden = computeProgressFromAnswers(
      'location', [], undefined, gatedPhases, new Set(['gated_photo']),
    );
    expect(hidden.total).toBe(0);
    expect(hidden.done).toBe(0);
  });

  it('counts the real check-in walkthrough video via a media key', () => {
    // fv_video_checkin_walkthrough is the location-scoped required file
    // question that kept every property ring ~1 short in the field.
    const without = computeProgressFromAnswers('location', []);
    const withMedia = computeProgressFromAnswers(
      'location', [], undefined, undefined,
      new Set(['fv_video_checkin_walkthrough']),
    );
    expect(withMedia.done).toBe(without.done + 1);
    expect(withMedia.total).toBe(without.total);
  });

  it('remainingRequiredForTarget drops a media-answered file question', () => {
    const target = {
      label: 'Prop',
      scope: 'location' as HubScope,
      answers: [],
      phases,
    };
    const before = remainingRequiredForTarget(target);
    expect(before.map((q) => q.slug)).toContain('photo_q');
    const after = remainingRequiredForTarget({
      ...target,
      mediaKeys: new Set(['photo_q']),
    });
    expect(after.map((q) => q.slug)).not.toContain('photo_q');
    // The text question is still remaining — media never satisfies it.
    expect(after.map((q) => q.slug)).toContain('text_q');
  });
});
