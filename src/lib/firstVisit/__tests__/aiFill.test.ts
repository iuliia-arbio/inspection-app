import { describe, it, expect, beforeEach } from 'vitest';
import { writeAiSuggestions, acceptAiRows, maxStepIndexForGroup, isAiSnapshot, unwrapAiSnapshot } from '../aiFill';
import { localDb, type LocalAnswer } from '../db';
import type { ValidatedExtraction } from '../validateExtraction';

const base = {
  inspectionId: 'insp1',
  targetId: 'unit1',
  areaKey: '9d',
  scope: 'unit_category' as const,
  ctx: { unit_category_id: 'uc1' },
  groupSlugsByGroup: { finding: ['finding_item_name', 'finding_category', 'finding_cost_estimate_eur'] },
};

beforeEach(async () => {
  await localDb.answers.clear();
  await localDb.outbox.clear();
});

describe('writeAiSuggestions', () => {
  it('writes a single field as an unconfirmed AI suggestion', async () => {
    const extraction: ValidatedExtraction = {
      singles: { fv_furniture_status: { value: 'Mostly', confidence: 0.8 } },
      items: [],
      summary: null, warnings: [],
    };
    const res = await writeAiSuggestions({ ...base, extraction, answers: {} });
    expect(res.singlesWritten).toBe(1);
    const row = res.writtenRows[0];
    expect(row.value).toBeNull();
    expect(row.was_prefilled).toBe(true);
    expect(row.was_accepted_as_is).toBe(false);
    expect(isAiSnapshot(row.hub_suggestion_snapshot)).toBe(true);
    expect(unwrapAiSnapshot(row.hub_suggestion_snapshot)).toBe('Mostly');
    // persisted + enqueued
    expect(await localDb.answers.count()).toBe(1);
    expect(await localDb.outbox.count()).toBe(1);
  });

  it('does not clobber an already-answered field', async () => {
    const answers: Record<string, LocalAnswer> = {
      'unit1::9d::fv_furniture_status': {
        id: 'x', inspection_id: 'insp1', target_id: 'unit1', scope: 'unit_category',
        question_key: 'fv_furniture_status', area_key: '9d', step_index: null,
        value: 'Yes fully', was_prefilled: false, was_accepted_as_is: true,
        created_at: 'now', updated_at: 'now',
      },
    };
    const extraction: ValidatedExtraction = {
      singles: { fv_furniture_status: { value: 'Mostly', confidence: 0.8 } }, items: [], summary: null, warnings: [],
    };
    const res = await writeAiSuggestions({ ...base, extraction, answers });
    expect(res.singlesWritten).toBe(0);
  });

  it('appends repeater items at fresh step indices', async () => {
    const extraction: ValidatedExtraction = {
      singles: {},
      items: [
        { group_id: 'finding', fields: { finding_item_name: { value: 'Broken oven', confidence: 0.9 }, finding_category: { value: 'Appliance', confidence: 0.8 } } },
        { group_id: 'finding', fields: { finding_item_name: { value: 'Stained sofa', confidence: 0.7 } } },
      ],
      summary: null, warnings: [],
    };
    const res = await writeAiSuggestions({ ...base, extraction, answers: {} });
    expect(res.itemsWritten).toBe(2);
    const steps = res.writtenRows.filter((r) => r.question_key === 'finding_item_name').map((r) => r.step_index).sort();
    expect(steps).toEqual([0, 1]);
  });

  it('acceptAiRows confirms suggestions into their snapshot value', async () => {
    const extraction: ValidatedExtraction = {
      singles: { fv_furniture_status: { value: 'Mostly', confidence: 0.8 } }, items: [], summary: null, warnings: [],
    };
    const { writtenRows } = await writeAiSuggestions({ ...base, extraction, answers: {} });
    const updated = await acceptAiRows(writtenRows);
    expect(updated).toHaveLength(1);
    expect(updated[0].value).toBe('Mostly');
    expect(updated[0].was_accepted_as_is).toBe(true);
    // persisted
    const stored = await localDb.answers.get(updated[0].id);
    expect(stored?.value).toBe('Mostly');
  });

  it('acceptAiRows keeps a value the user typed after the voice fill', async () => {
    const extraction: ValidatedExtraction = {
      singles: {
        fv_furniture_status: { value: 'Mostly', confidence: 0.8 },
        fv_room_size: { value: '20 sqm', confidence: 0.9 },
      },
      items: [], summary: null, warnings: [],
    };
    const { writtenRows } = await writeAiSuggestions({ ...base, extraction, answers: {} });
    // Inspector manually answers one suggested field AFTER the voice fill (same row id).
    const typed = writtenRows.find((r) => r.question_key === 'fv_furniture_status')!;
    await localDb.answers.put({ ...typed, value: 'Yes fully', was_prefilled: false, updated_at: 'later' });

    const updated = await acceptAiRows(writtenRows); // stale snapshots passed in
    // The typed field is skipped — user's value wins.
    expect(updated.find((r) => r.question_key === 'fv_furniture_status')).toBeUndefined();
    const stored = await localDb.answers.get(typed.id);
    expect(stored?.value).toBe('Yes fully');
    // The untouched suggestion still gets accepted.
    expect(updated.find((r) => r.question_key === 'fv_room_size')?.value).toBe('20 sqm');
  });

  it('acceptAiRows spreads from the fresh row, preserving a note added meanwhile', async () => {
    const extraction: ValidatedExtraction = {
      singles: { fv_furniture_status: { value: 'Mostly', confidence: 0.8 } }, items: [], summary: null, warnings: [],
    };
    const { writtenRows } = await writeAiSuggestions({ ...base, extraction, answers: {} });
    // Inspector adds a note (still unconfirmed suggestion) after the voice fill.
    await localDb.answers.put({ ...writtenRows[0], notes: 'check again next visit' });

    const updated = await acceptAiRows(writtenRows);
    expect(updated).toHaveLength(1);
    expect(updated[0].value).toBe('Mostly');
    expect(updated[0].was_accepted_as_is).toBe(true);
    expect(updated[0].notes).toBe('check again next visit');
    expect((await localDb.answers.get(writtenRows[0].id))?.notes).toBe('check again next visit');
  });

  it('acceptAiRows skips rows deleted since the suggestion was written', async () => {
    const extraction: ValidatedExtraction = {
      singles: { fv_furniture_status: { value: 'Mostly', confidence: 0.8 } }, items: [], summary: null, warnings: [],
    };
    const { writtenRows } = await writeAiSuggestions({ ...base, extraction, answers: {} });
    await localDb.answers.delete(writtenRows[0].id);
    const updated = await acceptAiRows(writtenRows);
    expect(updated).toHaveLength(0);
  });

  it('writes the qualitative summary directly to value when summarySlug is set', async () => {
    const extraction: ValidatedExtraction = {
      singles: { fv_furniture_status: { value: 'Mostly', confidence: 0.8 } },
      items: [],
      summary: 'Furnished to a good standard; minor wear on the sofa.',
      warnings: [],
    };
    const res = await writeAiSuggestions({ ...base, extraction, answers: {}, summarySlug: 'p10_condition__summary' });
    const summaryRow = res.writtenRows.find((r) => r.question_key === 'p10_condition__summary');
    expect(summaryRow?.value).toBe('Furnished to a good standard; minor wear on the sofa.');
    expect(summaryRow?.was_prefilled).toBe(true);
    expect(summaryRow?.hub_suggestion_snapshot).toBeUndefined();
    // structured single still written alongside
    expect(res.singlesWritten).toBe(1);
  });

  it('writes no summary row when extraction.summary is null', async () => {
    const extraction: ValidatedExtraction = { singles: {}, items: [], summary: null, warnings: [] };
    const res = await writeAiSuggestions({ ...base, extraction, answers: {}, summarySlug: 'p10_condition__summary' });
    expect(res.writtenRows.find((r) => r.question_key === 'p10_condition__summary')).toBeUndefined();
  });

  it('with writeStructured:false writes only the summary, not the fields', async () => {
    const extraction: ValidatedExtraction = {
      singles: { fv_furniture_status: { value: 'Mostly', confidence: 0.8 } },
      items: [],
      summary: 'Qualitative recap only.',
      warnings: [],
    };
    const res = await writeAiSuggestions({
      ...base, extraction, answers: {}, summarySlug: 'p10_condition__summary', writeStructured: false,
    });
    expect(res.singlesWritten).toBe(0);
    expect(res.writtenRows).toHaveLength(1);
    expect(res.writtenRows[0].question_key).toBe('p10_condition__summary');
  });

  it('overwrites an existing summary row (re-record = redo), reusing its id', async () => {
    const answers: Record<string, LocalAnswer> = {
      'unit1::9d::p10_condition__summary': {
        id: 'sum1', inspection_id: 'insp1', target_id: 'unit1', scope: 'unit_category',
        question_key: 'p10_condition__summary', area_key: '9d', step_index: null,
        value: 'old recap', was_prefilled: true, was_accepted_as_is: false,
        created_at: 'then', updated_at: 'then',
      },
    };
    const extraction: ValidatedExtraction = { singles: {}, items: [], summary: 'new recap', warnings: [] };
    const res = await writeAiSuggestions({ ...base, extraction, answers, summarySlug: 'p10_condition__summary' });
    const row = res.writtenRows.find((r) => r.question_key === 'p10_condition__summary');
    expect(row?.id).toBe('sum1');
    expect(row?.value).toBe('new recap');
    expect(row?.created_at).toBe('then');
  });

  it('allocates step_index above existing blocks', () => {
    const answers: Record<string, LocalAnswer> = {
      'unit1::9d::finding_item_name::0': {
        id: 'a', inspection_id: 'insp1', target_id: 'unit1', scope: 'unit_category',
        question_key: 'finding_item_name', area_key: '9d', step_index: 0,
        value: 'x', was_prefilled: false, was_accepted_as_is: false, created_at: 'n', updated_at: 'n',
      },
    };
    expect(maxStepIndexForGroup(answers, base.groupSlugsByGroup.finding, 'unit1', '9d')).toBe(0);
  });
});
