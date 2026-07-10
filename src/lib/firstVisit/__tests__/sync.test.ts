import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { localDb } from '../db';
import {
  enqueue,
  drainOutbox,
  cancelScheduledDrain,
  DRAIN_DEBOUNCE_MS,
} from '../sync';

// The debounced drain-on-enqueue builds its own handlers via createHandlers();
// mock the module so that drain is observable (and never hits fetch). Tests
// that call drainOutbox directly pass handlers explicitly and are unaffected.
const { debouncedHandler } = vi.hoisted(() => ({ debouncedHandler: vi.fn() }));
vi.mock('../handlers', () => ({
  createHandlers: () => ({ answer_upsert: debouncedHandler }),
}));

describe('sync engine', () => {
  beforeEach(async () => {
    await localDb.outbox.clear();
  });

  it('enqueues a job', async () => {
    await enqueue('answer_upsert', { foo: 1 });
    const jobs = await localDb.outbox.toArray();
    expect(jobs).toHaveLength(1);
  });

  it('drains jobs by calling the registered handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await enqueue('answer_upsert', { foo: 1 });
    await drainOutbox({ answer_upsert: handler } as never);
    expect(handler).toHaveBeenCalledOnce();
    expect(await localDb.outbox.count()).toBe(0);
  });

  it('keeps job in outbox on handler failure, increments attempts', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    await enqueue('answer_upsert', { foo: 1 });
    await drainOutbox({ answer_upsert: handler } as never);
    const jobs = await localDb.outbox.toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].attempts).toBe(1);
    expect(jobs[0].last_error).toContain('boom');
  });

  it('single-flight: concurrent drain calls process each job exactly once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const handler = vi.fn().mockImplementation(() => gate);
    await enqueue('media_upload', { media_id: 'm1', inspection_id: 'i1' });
    const p1 = drainOutbox({ media_upload: handler } as never);
    const p2 = drainOutbox({ media_upload: handler } as never); // must NOT start a second pass
    release();
    await Promise.all([p1, p2]);
    expect(handler).toHaveBeenCalledOnce(); // without the lock this is 2 → double-POST
    expect(await localDb.outbox.count()).toBe(0);
  });

  it('a job enqueued mid-drain is processed by the rerun pass, not stranded', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const handler = vi.fn().mockImplementation(() => gate);
    await enqueue('answer_upsert', { inspection_id: 'i1' });
    const p1 = drainOutbox({ answer_upsert: handler } as never);
    await enqueue('answer_upsert', { inspection_id: 'i1' }); // lands mid-drain
    const p2 = drainOutbox({ answer_upsert: handler } as never); // requests a rerun
    release();
    await Promise.all([p1, p2]);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await localDb.outbox.count()).toBe(0);
  });
});

describe('debounced drain-on-enqueue', () => {
  const setOnline = (value: boolean) =>
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value,
    });

  // fake-indexeddb resolves on real setImmediate macrotasks (never faked
  // here), so after firing the debounce timer we must yield to the macrotask
  // queue for the drain's Dexie work to complete.
  const flushIdb = async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));
  };

  beforeEach(() => {
    debouncedHandler.mockReset().mockResolvedValue(undefined);
    // Only fake setTimeout: fake-indexeddb's async scheduling must keep
    // running for Dexie awaits to resolve without manual timer advances.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    cancelScheduledDrain();
    vi.useRealTimers();
    setOnline(true);
  });

  it('enqueue triggers a drain after the debounce window', async () => {
    await enqueue('answer_upsert', { inspection_id: 'i1' });
    expect(debouncedHandler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DRAIN_DEBOUNCE_MS);
    await flushIdb();
    expect(debouncedHandler).toHaveBeenCalledOnce();
    expect(await localDb.outbox.count()).toBe(0);
  });

  it('burst typing collapses into ONE drain after the last enqueue', async () => {
    await enqueue('answer_upsert', { inspection_id: 'i1' });
    await vi.advanceTimersByTimeAsync(500);
    await enqueue('answer_upsert', { inspection_id: 'i1' });
    await vi.advanceTimersByTimeAsync(500);
    await enqueue('answer_upsert', { inspection_id: 'i1' }); // t=1000, fires at t=2500
    await vi.advanceTimersByTimeAsync(1400); // t=2400 — still inside the window
    expect(debouncedHandler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200); // t=2600 — window closed
    await flushIdb();
    expect(debouncedHandler).toHaveBeenCalledTimes(3); // one drain, 3 jobs
    expect(await localDb.outbox.count()).toBe(0);
  });

  it('offline: enqueue schedules no drain — jobs wait for the online event path', async () => {
    setOnline(false);
    await enqueue('answer_upsert', { inspection_id: 'i1' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(debouncedHandler).not.toHaveBeenCalled();
    expect(await localDb.outbox.count()).toBe(1);
  });

  it('cancelScheduledDrain clears the pending timer (test isolation hook)', async () => {
    await enqueue('answer_upsert', { inspection_id: 'i1' });
    cancelScheduledDrain();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(debouncedHandler).not.toHaveBeenCalled();
    expect(await localDb.outbox.count()).toBe(1);
  });
});
