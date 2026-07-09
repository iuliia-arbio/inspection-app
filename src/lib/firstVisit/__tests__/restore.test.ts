import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { localDb } from '../db';
import { restoreFromCloud } from '../restore';

const hubInspection = {
  id: 'i1',
  deal_id: 'd1',
  status: 'submitted' as const,
  inspector_email: 'a@arbio.com',
  started_at: '2026-07-09T08:00:00.000Z',
  submitted_at: '2026-07-09T08:57:38.000Z',
};

const hubTarget = {
  id: 't1',
  inspection_id: 'i1',
  kind: 'property' as const,
  parent_id: null,
  location_id: 'loc1',
  unit_category_id: null,
  label: 'Behnitzer Dorfstraße 79',
  created_on_site: false,
  order: 0,
};

const hubAnswer = {
  id: 'a1',
  inspection_id: 'i1',
  target_id: 't1',
  scope: 'location' as const,
  location_id: 'loc1',
  unit_category_id: null,
  question_key: 'fv_cleaning_setup',
  area_key: 'phase',
  step_index: -1,
  value: 'External provider',
  notes: null,
  data_point_slug: 'fv_cleaning_setup',
  hub_suggestion_snapshot: null,
  was_prefilled: false,
  was_accepted_as_is: false,
  created_at: '2026-07-09T08:30:00.000Z',
  updated_at: '2026-07-09T08:30:00.000Z',
};

function mockPayload(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status, json: async () => payload }),
  );
}

describe('restoreFromCloud', () => {
  beforeEach(async () => {
    await localDb.inspections.clear();
    await localDb.targets.clear();
    await localDb.answers.clear();
    await localDb.outbox.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hydrates an empty device and never touches the outbox', async () => {
    mockPayload({ inspections: [hubInspection], targets: [hubTarget], answers: [hubAnswer] });
    const r = await restoreFromCloud();
    expect(r).toEqual({ inspections: 1, targets: 1, answers: 1 });

    const insp = await localDb.inspections.get('i1');
    expect(insp?.status).toBe('submitted');
    const target = await localDb.targets.get('t1');
    expect(target?.kind).toBe('property');
    const answer = await localDb.answers.get('a1');
    expect(answer?.value).toBe('External provider');
    // Server -1 sentinel maps back to the local "single answer" null.
    expect(answer?.step_index).toBeNull();
    expect(answer?.synced_at).toBeTruthy();

    expect(await localDb.outbox.count()).toBe(0);
  });

  it('keeps repeater step_index >= 0 as-is', async () => {
    mockPayload({
      inspections: [hubInspection],
      targets: [hubTarget],
      answers: [{ ...hubAnswer, id: 'a2', step_index: 1 }],
    });
    await restoreFromCloud();
    expect((await localDb.answers.get('a2'))?.step_index).toBe(1);
  });

  it('does not overwrite a local answer that is newer than the hub copy', async () => {
    await localDb.answers.put({
      id: 'a1',
      inspection_id: 'i1',
      target_id: 't1',
      scope: 'location',
      question_key: 'fv_cleaning_setup',
      area_key: 'phase',
      value: 'newer local edit',
      was_prefilled: false,
      was_accepted_as_is: false,
      created_at: '2026-07-09T08:30:00.000Z',
      updated_at: '2026-07-09T09:00:00.000Z', // newer than hub's 08:30
    });
    mockPayload({ inspections: [], targets: [], answers: [hubAnswer] });
    const r = await restoreFromCloud();
    expect(r.answers).toBe(0);
    expect((await localDb.answers.get('a1'))?.value).toBe('newer local edit');
  });

  it('overwrites a local answer when the hub copy is newer', async () => {
    await localDb.answers.put({
      id: 'a1',
      inspection_id: 'i1',
      target_id: 't1',
      scope: 'location',
      question_key: 'fv_cleaning_setup',
      area_key: 'phase',
      value: 'stale local',
      was_prefilled: false,
      was_accepted_as_is: false,
      created_at: '2026-07-09T07:00:00.000Z',
      updated_at: '2026-07-09T07:00:00.000Z', // older than hub's 08:30
    });
    mockPayload({ inspections: [], targets: [], answers: [hubAnswer] });
    const r = await restoreFromCloud();
    expect(r.answers).toBe(1);
    expect((await localDb.answers.get('a1'))?.value).toBe('External provider');
  });

  it('upgrades a local draft to submitted but never replaces an existing inspection', async () => {
    await localDb.inspections.put({
      id: 'i1',
      deal_id: 'd1',
      status: 'draft',
      inspector_email: 'a@arbio.com',
      started_at: '2026-07-09T08:00:00.000Z',
    });
    mockPayload({ inspections: [hubInspection], targets: [], answers: [] });
    await restoreFromCloud();
    const insp = await localDb.inspections.get('i1');
    expect(insp?.status).toBe('submitted');
    expect(insp?.submitted_at).toBe('2026-07-09T08:57:38.000Z');
  });

  it('anchors deal-scoped answers without target_id to the visit root and drops unplaceable ones', async () => {
    mockPayload({
      inspections: [],
      targets: [],
      answers: [
        { ...hubAnswer, id: 'a3', target_id: null, scope: 'deal' },
        { ...hubAnswer, id: 'a4', target_id: null, scope: 'unit_category' },
      ],
    });
    const r = await restoreFromCloud();
    expect(r.answers).toBe(1);
    expect((await localDb.answers.get('a3'))?.target_id).toBe('i1');
    expect(await localDb.answers.get('a4')).toBeUndefined();
  });

  it('throws on a non-OK response', async () => {
    mockPayload({}, false, 401);
    await expect(restoreFromCloud()).rejects.toThrow('restore failed (401)');
  });
});
