import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb } from '../db';
import { enqueue, drainOutbox } from '../sync';

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
