# Batch G — Sync Visibility + Soft Submit Gate + Instant Push — Implementation Plan (2026-07-10)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** (1) The sync engine never fails silently — a stuck outbox surfaces on the SyncBadge with a count + last error and a tap-to-retry; (2) submitting with undelivered answers shows a soft gate ("X answers haven't reached the hub yet" + Retry + explicit "Submit anyway") and never hard-blocks; (3) answers reach the hub moments after entry via a debounced drain-on-enqueue, single-flight so concurrent drains can never double-POST (the media insert is NOT idempotent), and queued work also drains on the visits list, not just inside an open survey.

**Branch:** `feat/fv-cloud-restore` (PR #29, HEAD `61fbbb0`). Merging to upstream `main` auto-deploys to prod (`inspection-app-y517`).

**Plan doc:** `docs/plans/2026-07-09-fv-field-fixes.md` (Batch G + locked decisions at the bottom).

**Testing note:** NEVER run more than one vitest at a time. `npx vitest run --pool=forks <path>`. `npx tsc --noEmit` is the only gate that typechecks test files.

---

## Background for the implementer (verified against code at `61fbbb0`, read once)

- **`drainOutbox` has NO single-flight lock** (`src/lib/firstVisit/sync.ts:35-51`). It reads all jobs and processes them serially; per-job failures increment `attempts` + store `last_error` + `last_attempt_at` (schema already has all three fields — `db.ts:71-88` — no Dexie migration needed; `attempts`/`last_error` are non-indexed plain fields, and no index is needed since counts do full-table `toArray()` scans over a tiny table). `useSyncEngine` has its own `inFlight` ref (`useSyncEngine.ts:25,31-42`) which serializes calls **from that one hook instance only**. Two hook instances (VisitNavigator + the new MyVisits mount), or the new debounced drain firing beside the 30 s timer, CAN run `drainOutbox` concurrently → both read the same job list before either deletes → double-execution. `answer_upsert` is a hub upsert (safe-ish); **`media_upload` ends in a plain `.insert` on `first_visit_media` (`src/app/api/first-visit/media/route.ts:128`) — NOT idempotent** → a module-level single-flight lock in `sync.ts` is mandatory before adding any new drain trigger.
- **Error swallowing inventory:** `useSyncEngine.ts:53,59,62` — `syncNow().catch(() => {})` ×3 (drain-level failures vanish); `VisitNavigator.tsx:527` — `syncNow().catch(() => {})` after submit. Per-JOB errors are already recorded in the outbox row; the swallows hide only drain-level/Dexie errors — replace with `console.error` and rely on the stuck-state UI for user-facing visibility.
- **SyncBadge renders ONLY the offline state** (`SyncBadge.tsx:13` — `if (online || pending <= 0) return null`). Its test file pins "renders nothing while online, even with pending work" — that stays true for *healthy* pending work; the new failing state keys on **stuck** jobs, not pending ones.
- **`useSyncEngine` mounts only in `VisitNavigator.tsx:139`.** `MyVisits.tsx` has no engine — jobs enqueued from DealPicker (`resumeOrStartVisit` → `inspection_upsert`) or deletes made from the navigator sit until some survey page mounts. (VisitNavigator DOES drain on mount via the `[online, syncNow]` effect, so navigating into a visit flushes; the visits list itself never does.)
- **Per-inspection job identification (verified per kind, `handlers.ts` + call sites):**

  | kind | payload carries inspection id? |
  |---|---|
  | `inspection_upsert` | as `payload.id` (payload IS the LocalInspection) |
  | `target_upsert` | `payload.inspection_id` (LocalTarget) ✓ |
  | `target_delete` | `payload.inspection_id` ✓ (`VisitNavigator.tsx:302,317`) |
  | `answer_upsert` | `payload.inspection_id` (LocalAnswer) ✓ |
  | `media_upload` | `payload.inspection_id` ✓ (`useMediaCapture.ts:47-49`) |
  | `media_delete` | **NO — payload is `{ id }` only** (`useMediaCapture.ts:24`) → Task 3 adds `inspection_id` |
  | `submit` / `discard` | `payload.inspection_id` / n.a. — **excluded from the gate count** (control-flow, not answers) |

- **Current submit flow (post-Batch C/E — do not regress):** page button (`VisitNavigator.tsx:764-772`) increments `submitAttempt` and opens the dialog; `confirmSubmit` (`:514-529`) marks local status submitted, enqueues `submit`, fires `syncNow().catch(() => {})`, shows success. `isResubmit` (`:190`) relabels button + dialog. `VisitNavigator.submit.test.tsx` mocks BOTH `useSyncEngine` and `@/lib/firstVisit/sync` — those mock factories must gain the new exports.
- **enqueue call sites** (all funnel through `sync.ts enqueue()` — one hook point covers everything): `UnitSurvey.tsx:222,259,336` (answers), `aiFill.ts:192,220` (answer bursts — exactly what the debounce must batch), `useMediaCapture.ts:24,47`, `VisitNavigator.tsx:302,317,329,525`, `resumeOrStartVisit.ts:55` (plain TS, outside React), `sync.ts:32` (`ensureInspectionQueued`). `restore.ts` never enqueues (by design).
- **Circular-import check:** `handlers.ts` imports from `sync.ts` **type-only** (`import type { JobHandlers }`) — erased at runtime. `sync.ts` may therefore statically import `createHandlers` from `./handlers` with no runtime cycle.
- **Test-suite globals:** `vitest.setup.ts` clears every Dexie table in a global `beforeEach`. Real timers are the default; a debounce timer scheduled by `enqueue()` in one test could fire mid-later-test in the same file and mutate the outbox → Task 2 adds a `cancelScheduledDrain()` test hook called from the global setup (same spirit as `clearResumeInflight()` in `resumeOrStartVisit.ts:36`).
- **Tests using the REAL `sync.ts`** (get the new enqueue side effect): `sync.test.ts`, `ensureInspectionQueued.test.ts`, `deleteMedia.test.ts`, `resumeOrStartVisit.test.ts` (mocks sync — safe). **Tests MOCKING `@/lib/firstVisit/sync`** (factories must be extended only where the component calls new exports): the two VisitNavigator test files; the six UnitSurvey test files mock only `enqueue`/`ensureInspectionQueued` and UnitSurvey gains no new sync import — untouched.

### Locked design decisions (from the plan doc — do not re-litigate)

| Question | Decision |
|---|---|
| Where does the debounce live? | Inside `sync.ts` (`enqueue()` → `scheduleDrain()`), with `createHandlers()` imported directly — works from every call site incl. non-React (`resumeOrStartVisit`, `aiFill`), no registration step, no lost events on pages without an engine. |
| Offline drain storm? | `scheduleDrain()` no-ops when `!navigator.onLine`; the existing `online` event in `useSyncEngine` remains the come-back-online trigger. |
| Double-drain (timer/focus/manual/debounce)? | Module-level single-flight in `drainOutbox` itself with a rerun flag (re-runs once if requested mid-drain, so a job enqueued during a drain isn't stranded). Fixes the latent media double-insert risk. |
| Debounce delay | 1500 ms (constant `DRAIN_DEBOUNCE_MS`), trailing-edge, resettable — burst typing / aiFill loops = one drain. |
| "Stuck" definition | `attempts >= STUCK_ATTEMPTS (3)`. Rationale: with instant push + 30 s retries, a single transient failure would flash the badge and self-heal; 3 failed attempts ≈ >1 min of real failure. `lastError` = `last_error` of the most recently attempted errored job. Badge shows count + error, online only; offline state unchanged. |
| Gate count | Jobs whose payload resolves to this `inspection_id`, excluding `submit`/`discard` kinds. Copy: "X answers haven't reached the hub yet". |
| Gate flow | Check on dialog open (+ background drain & re-check) AND on confirm (await drain → re-check → submit, or render the gate: Retry + "Submit anyway"). Never hard-block. "Submit anyway" runs exactly today's submit body. Re-submit heals stragglers (Batch C). |
| MyVisits | Mount the full `useSyncEngine` (30 s interval + focus + online + on-mount drain) and render the SyncBadge. Lighter drain-on-load rejected: it wouldn't retry stuck jobs while the inspector sits on the list. |

---

## Task 1: Single-flight `drainOutbox`

**Files:**
- Modify: `src/lib/firstVisit/sync.ts`
- Modify: `src/lib/firstVisit/__tests__/sync.test.ts`

**Step 1: Write the failing tests** (append to `sync.test.ts`):

```ts
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
```

Run: `npx vitest run --pool=forks src/lib/firstVisit/__tests__/sync.test.ts` → the first new test FAILS (handler called twice).

**Step 2: Implement** — in `sync.ts`, rename the current body to a private `drainOnce` and wrap:

```ts
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
  // ... exactly the current drainOutbox body (orderBy('created_at'), per-job
  // try/catch with attempts++/last_error/last_attempt_at) ...
}
```

**Step 3: Run the test file** → PASS. Commit:

```bash
git add src/lib/firstVisit/sync.ts src/lib/firstVisit/__tests__/sync.test.ts
git commit -m "fix(fv): single-flight outbox drain — concurrent drains could double-POST non-idempotent media inserts"
```

---

## Task 2: Debounced drain-on-enqueue (#12 instant push)

**Files:**
- Modify: `src/lib/firstVisit/sync.ts`
- Modify: `vitest.setup.ts` (cancel pending debounce between tests)
- Modify: `src/lib/firstVisit/__tests__/sync.test.ts`

**Step 1: Write the failing tests** (new `describe` in `sync.test.ts`; mock the handlers module so the debounce's drain is observable — `vi.mock` is hoisted, use `vi.hoisted`):

```ts
const { debouncedHandler } = vi.hoisted(() => ({ debouncedHandler: vi.fn() }));
vi.mock('../handlers', () => ({
  createHandlers: () => ({ answer_upsert: debouncedHandler }),
}));
```

Cases (each uses `vi.useFakeTimers()` in `beforeEach`, `vi.useRealTimers()` + `cancelScheduledDrain()` in `afterEach`; `debouncedHandler.mockReset().mockResolvedValue(undefined)`):

1. **enqueue triggers a drain after the debounce window:** `await enqueue('answer_upsert', { inspection_id: 'i1' })` → `expect(debouncedHandler).not.toHaveBeenCalled()` → `await vi.advanceTimersByTimeAsync(1500)` → called once, outbox empty.
2. **burst typing = ONE drain:** three enqueues at t=0/500/1000 (advance between) → nothing fires before the LAST enqueue's window closes (assert not called at t=2400; called after t=2600).
3. **offline: no drain scheduled:** `vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)` → enqueue → advance 10 s → handler never called, job still in outbox (the `online` event / interval path owns recovery).
4. **`cancelScheduledDrain` clears the timer:** enqueue → `cancelScheduledDrain()` → advance 5 s → handler never called.

Run → FAIL (`cancelScheduledDrain` / behavior missing).

**Step 2: Implement** in `sync.ts`:

```ts
import { createHandlers } from './handlers'; // type-only import the other way — no runtime cycle

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
```

And at the end of `enqueue()` (after the `outbox.add`): `scheduleDrain();`.

In `vitest.setup.ts`, extend the global `beforeEach`:

```ts
import { cancelScheduledDrain } from './src/lib/firstVisit/sync';
// inside the existing beforeEach, before the table clears:
cancelScheduledDrain();
```

(Protects every file that uses the real `enqueue` — `ensureInspectionQueued.test.ts`, `deleteMedia.test.ts`, etc. — from a stray 1.5 s timer draining the outbox mid-test.)

**Step 3: Run** the sync test file, then the two other real-sync files one at a time:
`npx vitest run --pool=forks src/lib/firstVisit/__tests__/ensureInspectionQueued.test.ts`, then `.../deleteMedia.test.ts` → all green.

**Step 4: Commit:**

```bash
git add src/lib/firstVisit/sync.ts vitest.setup.ts src/lib/firstVisit/__tests__/sync.test.ts
git commit -m "feat(fv): debounced drain-on-enqueue — answers reach the hub moments after entry

Local-first + outbox unchanged; enqueue schedules a 1.5 s trailing-edge drain
(offline: none — the online event / 30 s interval stay the retry path). The
single-flight lock from the previous commit makes overlap with the interval,
focus, and manual triggers safe."
```

---

## Task 3: Outbox stats (stuck/lastError) + per-inspection pending count

**Files:**
- Modify: `src/lib/firstVisit/sync.ts` (add `outboxStats`, `pendingCountForInspection`; delete `outboxCount` — its only consumer moves in Task 4)
- Modify: `src/lib/firstVisit/useMediaCapture.ts` (`media_delete` payload gains `inspection_id`)
- Modify: `src/lib/firstVisit/__tests__/sync.test.ts`, `src/lib/firstVisit/__tests__/deleteMedia.test.ts`

**Step 1: Failing tests** (append to `sync.test.ts`; write outbox rows directly via `localDb.outbox.add` to control `attempts`):

```ts
describe('outboxStats', () => {
  it('counts pending and stuck (attempts >= 3) and exposes the most recent error', async () => {
    await localDb.outbox.add({ kind: 'answer_upsert', payload: { inspection_id: 'i1' }, created_at: 1, attempts: 0 });
    await localDb.outbox.add({ kind: 'answer_upsert', payload: { inspection_id: 'i1' }, created_at: 2, attempts: 3, last_error: 'old boom', last_attempt_at: 100 });
    await localDb.outbox.add({ kind: 'media_upload', payload: { inspection_id: 'i1' }, created_at: 3, attempts: 5, last_error: 'new boom', last_attempt_at: 200 });
    const s = await outboxStats();
    expect(s).toEqual({ pending: 3, stuck: 2, lastError: 'new boom' });
  });
  it('a single transient failure is not stuck', async () => {
    await localDb.outbox.add({ kind: 'answer_upsert', payload: {}, created_at: 1, attempts: 1, last_error: 'blip', last_attempt_at: 1 });
    expect((await outboxStats()).stuck).toBe(0);
  });
});

describe('pendingCountForInspection', () => {
  it('counts jobs across kinds via payload inspection_id, inspection_upsert via payload.id', async () => {
    await localDb.outbox.add({ kind: 'answer_upsert', payload: { inspection_id: 'i1' }, created_at: 1, attempts: 0 });
    await localDb.outbox.add({ kind: 'inspection_upsert', payload: { id: 'i1' }, created_at: 2, attempts: 0 });
    await localDb.outbox.add({ kind: 'media_upload', payload: { media_id: 'm', inspection_id: 'i1' }, created_at: 3, attempts: 0 });
    await localDb.outbox.add({ kind: 'target_delete', payload: { id: 't', inspection_id: 'i1' }, created_at: 4, attempts: 0 });
    await localDb.outbox.add({ kind: 'answer_upsert', payload: { inspection_id: 'OTHER' }, created_at: 5, attempts: 0 });
    expect(await pendingCountForInspection('i1')).toBe(4);
  });
  it('excludes submit/discard jobs (control-flow, not answers)', async () => {
    await localDb.outbox.add({ kind: 'submit', payload: { inspection_id: 'i1' }, created_at: 1, attempts: 0 });
    expect(await pendingCountForInspection('i1')).toBe(0);
  });
});
```

In `deleteMedia.test.ts`, extend the uploaded-row case: the enqueued `media_delete` payload carries `inspection_id` equal to the deleted row's.

Run each file → FAIL.

**Step 2: Implement** in `sync.ts` (replacing `outboxCount`):

```ts
// A job is STUCK after 3 failed attempts — with instant push + 30 s retries
// that's over a minute of real failure, so the badge doesn't flap on a single
// transient blip that the next retry heals.
export const STUCK_ATTEMPTS = 3;

export type OutboxStats = { pending: number; stuck: number; lastError?: string };

export async function outboxStats(): Promise<OutboxStats> {
  const jobs = await localDb.outbox.toArray();
  const errored = jobs
    .filter((j) => j.last_error)
    .sort((a, b) => (b.last_attempt_at ?? 0) - (a.last_attempt_at ?? 0));
  return {
    pending: jobs.length,
    stuck: jobs.filter((j) => j.attempts >= STUCK_ATTEMPTS).length,
    lastError: errored[0]?.last_error,
  };
}

// Which inspection a job belongs to. Every kind's payload carries
// inspection_id except inspection_upsert, whose payload IS the inspection.
function jobInspectionId(job: OutboxJob): string | undefined {
  const p = job.payload as { inspection_id?: string; id?: string } | null;
  return job.kind === 'inspection_upsert' ? p?.id : p?.inspection_id;
}

// Undelivered field data for ONE inspection — feeds the soft submit gate.
// submit/discard jobs are control-flow, not answers, and are excluded.
export async function pendingCountForInspection(inspectionId: string): Promise<number> {
  const jobs = await localDb.outbox.toArray();
  return jobs.filter(
    (j) => j.kind !== 'submit' && j.kind !== 'discard' && jobInspectionId(j) === inspectionId,
  ).length;
}
```

In `useMediaCapture.ts:24`: `await enqueue('media_delete', { id, inspection_id: row.inspection_id });` (the handler builds a query string from `id` only — extra field is inert on the wire).

**Step 3: Run both test files** → PASS. Commit:

```bash
git add src/lib/firstVisit/sync.ts src/lib/firstVisit/useMediaCapture.ts src/lib/firstVisit/__tests__/sync.test.ts src/lib/firstVisit/__tests__/deleteMedia.test.ts
git commit -m "feat(fv): outbox stats (stuck jobs + last error) and per-inspection pending count"
```

---

## Task 4: `useSyncEngine` surfaces stuck state; stop swallowing errors

**Files:**
- Modify: `src/lib/firstVisit/useSyncEngine.ts`
- Modify: `src/lib/firstVisit/__tests__/useSyncEngine.test.tsx` (currently tests only `useOnlineStatus`)

**Step 1: Failing tests** (new `describe('useSyncEngine')`; fake-indexeddb is global; handlers = `{ answer_upsert: vi.fn() }`):

1. **exposes stuck + lastError:** seed `localDb.outbox` with a job `attempts: 3, last_error: 'boom', last_attempt_at: 1` whose kind has NO handler (so the on-mount drain can't clear it — `drainOnce` skips kinds without handlers, leaving the row intact); `renderHook(() => useSyncEngine({}))`; `await waitFor(() => expect(result.current.stuck).toBe(1))`; `expect(result.current.lastError).toBe('boom')`.
2. **drains on mount when online and refreshes counts:** seed one `answer_upsert` job with a resolving handler → `waitFor` handler called and `result.current.pending === 0`.

**Step 2: Implement:**

- Replace `outboxCount` usage: `const [stats, setStats] = useState<OutboxStats>({ pending: 0, stuck: 0 });` and `refresh` sets `await outboxStats()` (import both from `./sync`).
- Return `{ pending: stats.pending, stuck: stats.stuck, lastError: stats.lastError, syncNow, syncing }` (update the hook's return type annotation).
- Replace all three `.catch(() => {})` (`:53,59,62`) with `.catch((err) => console.error('[fv-sync] drain failed', err))` — per-job errors are already persisted on the outbox row and surfaced via `stuck`; drain-level errors now at least reach the console instead of vanishing.

**Step 3: Run** `npx vitest run --pool=forks src/lib/firstVisit/__tests__/useSyncEngine.test.tsx` → PASS. Commit:

```bash
git add src/lib/firstVisit/useSyncEngine.ts src/lib/firstVisit/__tests__/useSyncEngine.test.tsx
git commit -m "feat(fv): sync engine exposes stuck-job count + last error; drain errors logged, not swallowed"
```

---

## Task 5: SyncBadge failing state (online + stuck)

**Files:**
- Modify: `src/components/firstVisit/SyncBadge.tsx`
- Modify: `src/components/firstVisit/__tests__/SyncBadge.test.tsx`

**Step 1: Failing tests** (append; existing five tests must keep passing — pass no `stuck` prop in them, default 0):

```ts
it('shows a failing state when online with stuck jobs: count + retry + last error', () => {
  const onRetry = vi.fn();
  render(<SyncBadge pending={5} stuck={3} lastError="answers -> 500 boom" onRetry={onRetry} />);
  const badge = screen.getByRole('button', { name: /3 not syncing/i });
  expect(badge).toHaveAttribute('title', expect.stringContaining('boom'));
  fireEvent.click(badge);
  expect(onRetry).toHaveBeenCalledOnce();
});

it('healthy pending work while online still renders nothing', () => {
  const { container } = render(<SyncBadge pending={5} stuck={0} />);
  expect(container).toBeEmptyDOMElement();
});

it('offline takes precedence over stuck (retries are pointless offline)', () => {
  ONLINE = false;
  render(<SyncBadge pending={3} stuck={2} lastError="boom" />);
  expect(screen.getByText(/Offline — changes saved/i)).toBeInTheDocument();
  expect(screen.queryByText(/not syncing/i)).toBeNull();
});
```

**Step 2: Implement:**

```tsx
export function SyncBadge({
  pending,
  stuck = 0,
  lastError,
  onRetry,
}: {
  pending: number;
  stuck?: number;
  lastError?: string;
  onRetry?: () => void;
}) {
  const online = useOnlineStatus();
  if (!online) {
    if (pending <= 0) return null;
    return ( /* existing offline span, unchanged */ );
  }
  // Online with STUCK jobs (>= 3 failed attempts) is the one alarming state
  // worth surfacing: work is silently failing to reach the hub. Count + the
  // last error (title/long-press) + tap-to-retry, non-blocking.
  if (stuck > 0) {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={lastError ? `${lastError} — tap to retry` : 'Tap to retry'}
        className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
      >
        {stuck} not syncing
      </button>
    );
  }
  return null;
}
```

(Update the header comment: two states now — offline reassurance, online failure.)

**Step 3: Run the SyncBadge test file** → PASS (all 8). Commit:

```bash
git add src/components/firstVisit/SyncBadge.tsx src/components/firstVisit/__tests__/SyncBadge.test.tsx
git commit -m "feat(fv): SyncBadge shows a failing state when online with stuck jobs — count, last error, tap to retry"
```

---

## Task 6: Soft submit gate in VisitNavigator (+ wire the badge)

**Files:**
- Modify: `src/app/first-visit/[dealId]/[inspectionId]/VisitNavigator.tsx`
- Modify: `src/app/first-visit/[dealId]/[inspectionId]/__tests__/VisitNavigator.submit.test.tsx`
- Modify: `src/app/first-visit/[dealId]/[inspectionId]/__tests__/VisitNavigator.autoSeedUnit.test.tsx` (mock factory only)

**Step 1: Extend the mock factories FIRST** in both test files (VisitNavigator will import `pendingCountForInspection`; a `vi.mock` factory missing it makes the import binding undefined):

```ts
// VisitNavigator.submit.test.tsx — top-level, so tests can steer it:
const { pendingCountMock, syncNowMock } = vi.hoisted(() => ({
  pendingCountMock: vi.fn().mockResolvedValue(0),
  syncNowMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/firstVisit/useSyncEngine', () => ({
  useSyncEngine: () => ({ pending: 0, stuck: 0, lastError: undefined, syncing: false, syncNow: syncNowMock }),
  useOnlineStatus: () => true,
}));
vi.mock('@/lib/firstVisit/sync', () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  ensureInspectionQueued: vi.fn().mockResolvedValue(undefined),
  pendingCountForInspection: pendingCountMock,
}));
```

(`autoSeedUnit` test: add `pendingCountForInspection: vi.fn().mockResolvedValue(0)` to its sync mock; add `stuck: 0, lastError: undefined` to its engine mock if it has one.)

**Step 2: Write the failing tests** (in `VisitNavigator.submit.test.tsx`):

```ts
it('soft-gates confirm when answers are still pending: warning + Retry + Submit anyway', async () => {
  await seedProperty();
  pendingCountMock.mockResolvedValue(2); // stays pending through the pre-drain
  render(<VisitNavigator dealId={DEAL} inspectionId={INSPECTION} visitTitle="Test Visit" />);
  await waitFor(() => expect(screen.getByText('Main Building')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: 'Submit visit' }));
  const dialog = await screen.findByRole('dialog');
  // Gate copy (decision: "X answers haven't reached the hub yet"):
  expect(
    await within(dialog).findByText(/2 answers haven't reached the hub yet/i),
  ).toBeInTheDocument();
  // Never hard-blocked: an explicit override is offered instead of the plain confirm.
  const anyway = within(dialog).getByRole('button', { name: /Submit anyway/i });
  // Retry drains and re-checks; when the count clears, the normal confirm returns.
  pendingCountMock.mockResolvedValue(0);
  fireEvent.click(within(dialog).getByRole('button', { name: /Retry/i }));
  await waitFor(() =>
    expect(within(dialog).queryByText(/haven't reached the hub/i)).toBeNull(),
  );
  expect(syncNowMock).toHaveBeenCalled();
  expect(within(dialog).getByRole('button', { name: 'Submit visit' })).toBeInTheDocument();
});

it('Submit anyway proceeds exactly like a normal submit', async () => {
  await seedProperty();
  pendingCountMock.mockResolvedValue(2);
  render(<VisitNavigator dealId={DEAL} inspectionId={INSPECTION} visitTitle="Test Visit" />);
  await waitFor(() => expect(screen.getByText('Main Building')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Submit visit' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(await within(dialog).findByRole('button', { name: /Submit anyway/i }));
  await waitFor(() => expect(screen.getByText(/Visit submitted/i)).toBeInTheDocument());
  expect((await localDb.inspections.get(INSPECTION))?.status).toBe('submitted');
});

it('confirm drains first and re-checks: a gate appearing only at confirm time still catches', async () => {
  await seedProperty();
  pendingCountMock.mockResolvedValueOnce(0); // dialog-open check: clean
  render(<VisitNavigator dealId={DEAL} inspectionId={INSPECTION} visitTitle="Test Visit" />);
  await waitFor(() => expect(screen.getByText('Main Building')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Submit visit' }));
  const dialog = await screen.findByRole('dialog');
  pendingCountMock.mockResolvedValue(1); // by confirm time, a job is stuck
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit visit' }));
  expect(
    await within(dialog).findByText(/1 answer hasn't reached the hub yet/i),
  ).toBeInTheDocument();
  // NOT submitted:
  expect((await localDb.inspections.get(INSPECTION))?.status).toBe('draft');
});
```

Sanity: the three EXISTING tests must stay green with the default `pendingCountMock → 0` (draft submit, re-submit labels/copy from Batch C, `submitAttempt` escalation from Batch E — the gate must not touch the page-button `setSubmitAttempt` increment nor `isResubmit`).

Run → FAIL.

**Step 3: Implement in `VisitNavigator.tsx`:**

1. Import `pendingCountForInspection` from `@/lib/firstVisit/sync`; destructure `stuck, lastError` from `useSyncEngine`.
2. State + helpers:

```ts
// Soft submit gate (decided 2026-07-09): count of THIS inspection's outbox
// jobs that haven't reached the hub. Checked when the dialog opens (with a
// background drain that usually clears it before the inspector confirms) and
// again on confirm (drain → re-check → submit or show the gate). Never a hard
// block — "Submit anyway" always works, and Batch C's re-runnable submit
// heals any stragglers on the next re-submit.
const [pendingSync, setPendingSync] = useState(0);

const refreshPendingSync = useCallback(async () => {
  const n = await pendingCountForInspection(inspectionId);
  setPendingSync(n);
  return n;
}, [inspectionId]);

const openSubmitDialog = () => {
  setSubmitAttempt((n) => n + 1); // Batch E contract — every attempt escalates
  setSubmitState('confirming');
  void refreshPendingSync();
  syncNow()
    .then(refreshPendingSync)
    .catch((err) => console.error('[fv-sync] pre-submit drain failed', err));
};

const retrySync = async () => {
  await syncNow().catch((err) => console.error('[fv-sync] retry failed', err));
  await refreshPendingSync();
};
```

3. Rename the current `confirmSubmit` body to `doSubmit` (unchanged except: add `pending_sync: pendingSync` to the `submit_clicked` track payload, and replace the trailing `syncNow().catch(() => {})` with a `console.error` catch). New `confirmSubmit`:

```ts
const confirmSubmit = async () => {
  await syncNow().catch((err) => console.error('[fv-sync] pre-submit drain failed', err));
  const still = await refreshPendingSync();
  if (still > 0) {
    track('submit_gate_shown', { inspection_id: inspectionId, pending_sync: still });
    return; // dialog re-renders with the gate: Retry + Submit anyway
  }
  await doSubmit();
};
```

4. Page button `onClick` (`:765-768`) → `openSubmitDialog` (keeps the attempt counter semantics identical).
5. Badge wiring (`:660`): `<SyncBadge pending={pending} stuck={stuck} lastError={lastError} onRetry={syncNow} />`.
6. `SubmitDialog` gains props `pendingSync: number`, `onRetrySync: () => void`, `onSubmitAnyway: () => void`. In the confirming pane, above the footer buttons:

```tsx
{pendingSync > 0 && (
  <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
    <span>
      {pendingSync} answer{pendingSync === 1 ? " hasn't" : "s haven't"} reached
      the hub yet.
    </span>
    <button
      onClick={onRetrySync}
      className="shrink-0 rounded border border-amber-400 px-2 py-1 text-xs font-medium"
    >
      Retry
    </button>
  </div>
)}
```

and the primary button becomes the explicit override when gated:

```tsx
<button
  onClick={pendingSync > 0 ? onSubmitAnyway : onConfirm}
  className="flex-1 rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white"
>
  {pendingSync > 0 ? 'Submit anyway' : submitLabel}
</button>
```

Call site: `<SubmitDialog ... pendingSync={pendingSync} onRetrySync={retrySync} onSubmitAnyway={doSubmit} onConfirm={confirmSubmit} />`. (`submitLabel` already handles `Re-submit visit` — unchanged.)

**Step 4: Run** `npx vitest run --pool=forks "src/app/first-visit/[dealId]/[inspectionId]/__tests__/VisitNavigator.submit.test.tsx"` then the autoSeedUnit file → PASS. Commit:

```bash
git add "src/app/first-visit/[dealId]/[inspectionId]/VisitNavigator.tsx" "src/app/first-visit/[dealId]/[inspectionId]/__tests__/VisitNavigator.submit.test.tsx" "src/app/first-visit/[dealId]/[inspectionId]/__tests__/VisitNavigator.autoSeedUnit.test.tsx"
git commit -m "feat(fv): soft submit gate — 'X answers haven't reached the hub yet' + Retry + explicit Submit anyway

Drains before confirming, re-checks this inspection's outbox, never hard-
blocks; failing sync surfaces on the header badge instead of silently."
```

---

## Task 7: MyVisits mounts the sync engine (drain + badge on the visits list)

**Files:**
- Modify: `src/app/first-visit/MyVisits.tsx`
- Create: `src/app/first-visit/__tests__/MyVisits.sync.test.tsx` (no MyVisits test exists today — verified)

**Step 1: Failing test:**

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { localDb } from '@/lib/firstVisit/db';

vi.mock('@/lib/firstVisit/restore', () => ({
  restoreFromCloud: vi.fn().mockResolvedValue(undefined),
}));
const { answerHandler } = vi.hoisted(() => ({
  answerHandler: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/firstVisit/handlers', () => ({
  createHandlers: () => ({ answer_upsert: answerHandler }),
}));
import MyVisits from '../MyVisits';

beforeEach(() => {
  answerHandler.mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deals: [] }) }));
});

describe('MyVisits sync engine', () => {
  it('drains queued outbox work on mount — jobs no longer wait for a survey to open', async () => {
    await localDb.outbox.add({
      kind: 'answer_upsert',
      payload: { inspection_id: 'i1' },
      created_at: Date.now(),
      attempts: 0,
    });
    render(<MyVisits />);
    await waitFor(() => expect(answerHandler).toHaveBeenCalledOnce());
    expect(await localDb.outbox.count()).toBe(0);
  });

  it('surfaces stuck jobs on the visits list badge', async () => {
    await localDb.outbox.add({
      kind: 'media_upload', // no handler in the mock → survives the mount drain
      payload: { inspection_id: 'i1' },
      created_at: Date.now(),
      attempts: 3,
      last_error: 'PUT failed 500',
      last_attempt_at: Date.now(),
    });
    render(<MyVisits />);
    expect(await screen.findByText(/1 not syncing/i)).toBeInTheDocument();
  });
});
```

Run: `npx vitest run --pool=forks src/app/first-visit/__tests__/MyVisits.sync.test.tsx` → FAIL.

**Step 2: Implement** in `MyVisits.tsx`:

```ts
import { useMemo } from 'react'; // extend the existing react import
import { createHandlers } from '@/lib/firstVisit/handlers';
import { useSyncEngine } from '@/lib/firstVisit/useSyncEngine';
import { SyncBadge } from '@/components/firstVisit/SyncBadge';

// Inside the component:
// Full engine, not a one-shot drain: jobs enqueued elsewhere (DealPicker's
// inspection_upsert, deletes made in the navigator) used to sit until a
// survey opened; the engine's on-mount drain + 30 s interval + focus/online
// triggers retry them from the list too. drainOutbox is single-flight, so
// this second engine can't double-drain against an open navigator.
const handlers = useMemo(() => createHandlers(), []);
const { pending, stuck, lastError, syncNow } = useSyncEngine(handlers);
```

Render the badge above the list (next to the existing offline note):

```tsx
<div className="mb-2 flex justify-end">
  <SyncBadge pending={pending} stuck={stuck} lastError={lastError} onRetry={syncNow} />
</div>
```

**Step 3: Run the new test file** → PASS. Commit:

```bash
git add src/app/first-visit/MyVisits.tsx src/app/first-visit/__tests__/MyVisits.sync.test.tsx
git commit -m "feat(fv): visits list mounts the sync engine — queued work drains without opening a survey; stuck badge visible from the list"
```

---

## Task 8: Full verification

1. `npx tsc --noEmit` → clean (typechecks all new/changed test files).
2. `npx vitest run --pool=forks` (single full run) → all green. Watch specifically: `sync.test.ts`, `ensureInspectionQueued.test.ts`, `deleteMedia.test.ts`, `useSyncEngine.test.tsx`, `SyncBadge.test.tsx`, both VisitNavigator test files, the six UnitSurvey files (their sync mocks are intentionally untouched), `resumeOrStartVisit.test.ts`, `MediaGallery.test.tsx`.
3. Manual smoke (dev, DevTools Network tab):
   - Type an answer in a unit survey → a `POST /api/first-visit/answers` fires ~1.5 s after the last keystroke (not 30 s later); rapid typing across several fields → one drain burst.
   - DevTools offline → answer several questions → no request spam, badge shows the offline state; back online → drain fires once.
   - Block `/api/first-visit/answers` (devtools request blocking) → answer 3+ questions, wait through ≥3 retry attempts (~1–2 min) → badge turns "N not syncing", title shows the error, visits list shows the same badge; press Submit → dialog shows "N answers haven't reached the hub yet" + Retry, primary reads "Submit anyway". Unblock → Retry clears the gate → normal Submit; confirm hub `data_point_values` complete.
   - Delete a unit from the navigator, go straight to the visits list → the `target_delete` job drains there.
4. Push; comment on PR #29: sync failures now visible (stuck = 3+ attempts), soft submit gate wording, instant-push debounce design, and the single-flight lock closing the latent media double-insert.
5. Update `MEMORY.md`: Batch G shipped; note the double-drain/media-double-POST latent bug is fixed by the single-flight lock; `outboxCount` removed in favor of `outboxStats`.

---

## Explicitly out of scope (do NOT build)
- Retry/backoff policy changes, max-attempt dead-lettering, or job expiry (attempts keep incrementing; badge is the surface).
- Making the media POST idempotent server-side (the client single-flight lock removes the trigger; server hardening is separate debt).
- A "syncing…" in-flight badge (deliberately removed earlier for header-jitter reasons — keep it dead).
- Hard-blocking submit in any form, or auto-resubmit loops (re-submit heals stragglers per Batch C).
- Draining from the DealPicker page itself (its lone `inspection_upsert` is drained by the debounce, by the navigator on arrival, and by MyVisits).
- Per-question sync indicators in the survey UI.

## Test impact summary
- **New:** single-flight + debounce + stats/per-inspection tests in `sync.test.ts`; `useSyncEngine` engine tests; SyncBadge failing-state tests; three submit-gate tests; `MyVisits.sync.test.tsx`.
- **Modified:** `deleteMedia.test.ts` (payload gains `inspection_id`); both VisitNavigator test mock factories (`pendingCountForInspection`, `stuck`/`lastError`); `vitest.setup.ts` (global `cancelScheduledDrain`).
- **Breaks expected if skipped:** any test using the real `enqueue` without the setup-level `cancelScheduledDrain` (stray 1.5 s timers); VisitNavigator tests whose sync mock lacks `pendingCountForInspection` (undefined call in `openSubmitDialog`/`confirmSubmit`). UnitSurvey tests unaffected (no new sync imports there).
