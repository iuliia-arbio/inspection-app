import { localDb, type OutboxJob } from './db';
// handlers.ts imports from this module TYPE-ONLY (JobHandlers), so this static
// import creates no runtime cycle.
import { createHandlers } from './handlers';

export type JobHandlers = Record<OutboxJob['kind'], (payload: unknown) => Promise<void>>;

export async function enqueue(kind: OutboxJob['kind'], payload: unknown): Promise<void> {
  await localDb.outbox.add({
    kind,
    payload,
    created_at: Date.now(),
    attempts: 0,
  });
  scheduleDrain();
}

// Debounced instant push (#12, decided 2026-07-09): every enqueue schedules a
// drain ~1.5 s out, resetting on each new job, so an answer reaches the hub
// moments after entry while burst typing / aiFill loops collapse into ONE
// drain. Lives HERE (not in useSyncEngine) so it fires from every call site,
// including plain-TS ones (resumeOrStartVisit, aiFill) and pages with no
// engine mounted. Offline, we schedule nothing — the engine's `online` event
// and 30 s interval remain the retry/fallback path, and drainOutbox's
// single-flight lock makes any overlap with those triggers harmless.
export const DRAIN_DEBOUNCE_MS = 1500;
let drainTimer: ReturnType<typeof setTimeout> | undefined;

export function scheduleDrain(delayMs: number = DRAIN_DEBOUNCE_MS): void {
  if (typeof window === 'undefined') return; // SSR safety
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (drainTimer !== undefined) clearTimeout(drainTimer);
  drainTimer = setTimeout(() => {
    drainTimer = undefined;
    drainOutbox(createHandlers()).catch((err) =>
      console.error('[fv-sync] debounced drain failed', err),
    );
  }, delayMs);
}

// Test hook — pending debounce timers must not leak across tests.
export function cancelScheduledDrain(): void {
  if (drainTimer !== undefined) clearTimeout(drainTimer);
  drainTimer = undefined;
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
