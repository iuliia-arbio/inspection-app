import { localDb, type OutboxJob } from './db';

export type JobHandlers = Record<OutboxJob['kind'], (payload: unknown) => Promise<void>>;

export async function enqueue(kind: OutboxJob['kind'], payload: unknown): Promise<void> {
  await localDb.outbox.add({
    kind,
    payload,
    created_at: Date.now(),
    attempts: 0,
  });
}

// Re-ensure the hub has the parent inspection row for an open survey. The
// inspection is only enqueued once, when first created (DealPicker) — so if that
// single inspection_upsert never landed (offline / the auth-broken window), the
// inspection has no hub row and every child target/answer FK-fails forever with
// no recovery. Calling this on survey open re-queues an idempotent upsert so an
// orphaned parent self-heals on the next sync. Skips submitted inspections (to
// avoid clobbering their server-side submit state) and de-dupes against any
// inspection_upsert already pending in the outbox.
export async function ensureInspectionQueued(inspectionId: string): Promise<void> {
  const insp = await localDb.inspections.get(inspectionId);
  if (!insp || insp.status === 'submitted') return;
  const jobs = await localDb.outbox.toArray();
  const alreadyQueued = jobs.some(
    (j) =>
      j.kind === 'inspection_upsert' &&
      (j.payload as { id?: string } | null)?.id === inspectionId,
  );
  if (alreadyQueued) return;
  await enqueue('inspection_upsert', insp);
}

// Single-flight drain. Multiple triggers can now race (30 s interval, focus,
// online, manual Sync now, the debounced drain-on-enqueue, and TWO mounted
// engines once MyVisits gets one). Two concurrent drains read the same job
// list before either deletes → double execution; media_upload ends in a plain
// INSERT on the hub, so a double-drain literally duplicates media rows. One
// drain runs at a time; a call arriving mid-drain requests exactly one rerun
// so jobs enqueued during the pass aren't stranded until the next trigger.
let drainInFlight: Promise<void> | null = null;
let drainRerun = false;

export function drainOutbox(handlers: JobHandlers): Promise<void> {
  if (drainInFlight) {
    drainRerun = true;
    return drainInFlight;
  }
  drainInFlight = (async () => {
    try {
      do {
        drainRerun = false;
        await drainOnce(handlers);
      } while (drainRerun);
    } finally {
      drainInFlight = null;
    }
  })();
  return drainInFlight;
}

async function drainOnce(handlers: JobHandlers): Promise<void> {
  const jobs = await localDb.outbox.orderBy('created_at').toArray();
  for (const job of jobs) {
    const handler = handlers[job.kind];
    if (!handler) continue;
    try {
      await handler(job.payload);
      await localDb.outbox.delete(job.id!);
    } catch (err) {
      await localDb.outbox.update(job.id!, {
        attempts: job.attempts + 1,
        last_error: err instanceof Error ? err.message : String(err),
        last_attempt_at: Date.now(),
      });
    }
  }
}

export async function outboxCount(): Promise<number> {
  return localDb.outbox.count();
}
