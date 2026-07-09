import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb, type LocalInspection } from '../db';
import { resumeOrStartVisit, clearResumeInflight } from '../resumeOrStartVisit';
import { restoreFromCloud } from '../restore';
import { enqueue } from '../sync';

vi.mock('../restore', () => ({ restoreFromCloud: vi.fn() }));
vi.mock('../sync', () => ({ enqueue: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../analytics', () => ({ track: vi.fn() }));

const DEAL = 'd1';

const insp = (
  id: string,
  status: LocalInspection['status'],
  started_at: string,
): LocalInspection => ({
  id,
  deal_id: DEAL,
  status,
  inspector_email: 'a@arbio.com',
  started_at,
});

describe('resumeOrStartVisit', () => {
  beforeEach(async () => {
    clearResumeInflight();
    await localDb.inspections.clear();
    vi.mocked(restoreFromCloud).mockReset().mockResolvedValue({
      inspections: 0,
      targets: 0,
      answers: 0,
    });
    vi.mocked(enqueue).mockClear();
  });

  it('hydrates from the hub before resolving locally', async () => {
    // The mock stands in for a real restore: it seeds the hub's inspection
    // into Dexie. resumeOrStartVisit must see it — proving hydrate-then-resolve.
    vi.mocked(restoreFromCloud).mockImplementation(async () => {
      await localDb.inspections.put(insp('hub-1', 'draft', '2026-07-01T00:00:00Z'));
      return { inspections: 1, targets: 0, answers: 0 };
    });
    const r = await resumeOrStartVisit(DEAL);
    expect(r).toEqual({ id: 'hub-1', resumed: true });
    expect(enqueue).not.toHaveBeenCalled();
    expect(await localDb.inspections.count()).toBe(1);
  });

  it('resumes a SUBMITTED visit instead of creating a duplicate', async () => {
    await localDb.inspections.put(insp('sub-1', 'submitted', '2026-06-01T00:00:00Z'));
    const r = await resumeOrStartVisit(DEAL);
    expect(r).toEqual({ id: 'sub-1', resumed: true });
    expect(await localDb.inspections.count()).toBe(1);
  });

  it('picks the canonical inspection among duplicates', async () => {
    await localDb.inspections.bulkPut([
      insp('draft-early', 'draft', '2026-05-01T00:00:00Z'),
      insp('sub-1', 'submitted', '2026-06-15T00:00:00Z'),
      insp('draft-late', 'draft', '2026-07-01T00:00:00Z'),
    ]);
    const r = await resumeOrStartVisit(DEAL);
    expect(r).toEqual({ id: 'sub-1', resumed: true });
  });

  it('falls back to local when restore fails (offline)', async () => {
    vi.mocked(restoreFromCloud).mockRejectedValue(new Error('offline'));

    // With a local draft: resume it.
    await localDb.inspections.put(insp('local-1', 'draft', '2026-06-01T00:00:00Z'));
    expect(await resumeOrStartVisit(DEAL)).toEqual({ id: 'local-1', resumed: true });

    // With nothing local: create a fresh draft and enqueue it.
    await localDb.inspections.clear();
    const r = await resumeOrStartVisit(DEAL);
    expect(r.resumed).toBe(false);
    const created = await localDb.inspections.get(r.id);
    expect(created).toMatchObject({ deal_id: DEAL, status: 'draft' });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith('inspection_upsert', created);
  });

  it('creates only when hub AND local have none', async () => {
    const r = await resumeOrStartVisit(DEAL);
    expect(r.resumed).toBe(false);
    expect(await localDb.inspections.count()).toBe(1);
    expect((await localDb.inspections.get(r.id))?.status).toBe('draft');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('ignores inspections belonging to a different deal', async () => {
    await localDb.inspections.put({
      ...insp('other-1', 'submitted', '2026-06-01T00:00:00Z'),
      deal_id: 'some-other-deal',
    });
    const r = await resumeOrStartVisit(DEAL);
    expect(r.resumed).toBe(false);
    expect(r.id).not.toBe('other-1');
    expect((await localDb.inspections.get(r.id))?.deal_id).toBe(DEAL);
  });

  it('a concurrent double-tap resolves to ONE visit with ONE enqueue', async () => {
    const [a, b] = await Promise.all([resumeOrStartVisit(DEAL), resumeOrStartVisit(DEAL)]);
    expect(b.id).toBe(a.id);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await localDb.inspections.count()).toBe(1);
  });

  it('is idempotent on repeat selection', async () => {
    const first = await resumeOrStartVisit(DEAL);
    const second = await resumeOrStartVisit(DEAL);
    expect(second.id).toBe(first.id);
    expect(second.resumed).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await localDb.inspections.count()).toBe(1);
  });
});
