# Batch C — One Shared Visit per Deal + Reopenable Submits — Implementation Plan (2026-07-09)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Selecting a deal always resolves to that deal's ONE shared inspection (hub-resolved, adopted locally), creating a new one only when neither hub nor local has any — and a submitted visit can be reopened, edited, and re-submitted.

**Branch:** `feat/fv-cloud-restore` (PR #29). Merging to upstream `main` auto-deploys to prod (`inspection-app-y517`).

**Plan doc:** `docs/plans/2026-07-09-fv-field-fixes.md` (Batch C + locked decisions at the bottom).

**Testing note:** NEVER run more than one vitest at a time. `npx vitest run --pool=forks <path>`. `npx tsc --noEmit` is the only gate that typechecks test files.

---

## Background for the implementer (verified against code, read once)

- **Root cause of dupes:** `resumeOrStartVisit()` in `src/app/first-visit/new/DealPicker.tsx:11-34` checks ONLY local Dexie, and only resumes `status === 'draft'`. A cold device / evicted IndexedDB / second inspector / a deal whose visit is submitted → new `crypto.randomUUID()` inspection. Live prod: 13 inspections on one deal.
- **Restore exists and is the hydration path:** `restoreFromCloud()` (`src/lib/firstVisit/restore.ts`) downloads ALL non-discarded staff inspections + targets + answers from `GET /api/first-visit/restore` and writes them straight into Dexie (never via `enqueue`, no outbox echo; answers only overwritten when hub is strictly newer; inspections only added or draft→submitted upgraded). Today it runs only on the visits-list page (`MyVisits.tsx:50`) — a deep link to `/first-visit/new` skips it, and it fails silently offline.
- **Verified: there is almost no "submitted lock" today.** The full inventory of `status === 'submitted'` gates in the app:
  1. `DealPicker.tsx:17` — resume filter is draft-only (submitted visits get shadowed → new dupe). **This is the lock users hit.**
  2. `VisitNavigator.tsx:728-730` — SubmitDialog copy: *"You will not be able to edit this visit after submitting."* (copy only; nothing enforces it).
  3. `src/lib/firstVisit/sync.ts:22-33` — `ensureInspectionQueued` skips submitted inspections (deliberate: don't clobber server submit state; note `POST /api/first-visit/inspections` upserts `status` unconditionally, so re-queueing a stale local row COULD flip hub status — the skip stays).
  4. `src/lib/firstVisit/restore.ts:83-91` — draft→submitted one-way status upgrade (fine: we never flip back to draft, so no fight).
  - **NOT gated** (already editable/submittable post-submit, verified): `UnitSurvey.tsx` has zero status checks; `POST /api/first-visit/answers` has no status gate (answer edits on a submitted inspection already sync); `MyVisits.tsx` renders every row and links into the navigator regardless of status; `POST /api/first-visit/submit` has **no status gate** — it selects the inspection without filtering status, its `data_point_values` writes are `upsert(..., onConflict)`, and it re-sets `status='submitted', submitted_at=now()` at the end. **The submit route is already re-runnable; Batch C only pins that with a test** (full idempotency hardening stays in Batch G).
- **Local status decision (locked):** on reopen, local status **stays `'submitted'`** — answer edits sync as normal (`answer_upsert` has no gate), re-submit just re-enqueues the `submit` job. No status flapping, and `restore.ts`'s one-way upgrade can't fight it.
- **Canonical-pick rule (must tolerate pre-cleanup prod with N inspections per deal):** among non-discarded inspections of a deal, pick **submitted over draft, then earliest `started_at`, then lowest `id` (lexicographic)**. Deterministic on every device, stable before and after the (out-of-scope) cleanup script; after cleanup it trivially picks the single survivor. Rationale for earliest-started: the oldest row is the one most likely to hold the real visit's data (dupes are later cold-device re-creations), and "most answers" is not knowable client-side.

### Decision: how to resolve the hub inspection (chosen: reuse `restoreFromCloud()`)

| Option | Verdict |
|---|---|
| New `GET /api/first-visit/inspections?deal_id=` | Rejected. Adopting only the inspection *row* leaves the visit looking **empty** (no targets/answers) when the user deep-linked past the visits list — inviting re-entry and "my data is gone" panic. We'd re-fetch targets+answers anyway ≈ rebuilding restore. |
| Call `restoreFromCloud()` inside `resumeOrStartVisit()` before resolving | **Chosen.** One code path, no new endpoint, the resumed visit arrives with its targets + answers regardless of entry point, offline fallback is automatic (restore throws → resolve from local only), convergence = the same merge logic the visits list uses. Payload (~500–1000 rows, paginated) is already fetched on every list load; fine at current scale. |
| Reuse the restore *route* with a `deal_id` filter | Deferred (YAGNI). If restore payload gets heavy, add `?deal_id=` and thread through `restoreFromCloud(dealId?)` — client architecture unchanged. |

**Creation-race advisory (locked as "accept rare dupe"):** restore-before-create shrinks the window to seconds. If two devices still create simultaneously, both rows land; the deterministic canonical rule reconverges every later selection onto one winner (earliest `started_at`), the loser sits inert until cleanup discards it. Answers written to a loser in that window are not merged (same rule as prod cleanup). Do NOT build re-check-after-create or deterministic ids.

---

## Task 1: Canonical inspection picker

**Files:**
- Create: `src/lib/firstVisit/canonicalInspection.ts`
- Create: `src/lib/firstVisit/__tests__/canonicalInspection.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { pickCanonicalInspection } from '../canonicalInspection';

const insp = (id: string, status: 'draft' | 'submitted' | 'discarded', started_at: string) =>
  ({ id, status, started_at });

describe('pickCanonicalInspection', () => {
  it('returns undefined for an empty list', () => {
    expect(pickCanonicalInspection([])).toBeUndefined();
  });
  it('prefers submitted over draft regardless of start time', () => {
    expect(
      pickCanonicalInspection([
        insp('a', 'draft', '2026-01-01T00:00:00Z'),
        insp('b', 'submitted', '2026-06-01T00:00:00Z'),
      ])?.id,
    ).toBe('b');
  });
  it('breaks status ties by earliest started_at', () => {
    expect(
      pickCanonicalInspection([
        insp('late', 'draft', '2026-06-02T00:00:00Z'),
        insp('early', 'draft', '2026-06-01T00:00:00Z'),
      ])?.id,
    ).toBe('early');
  });
  it('breaks full ties by lowest id', () => {
    expect(
      pickCanonicalInspection([
        insp('bbb', 'draft', '2026-06-01T00:00:00Z'),
        insp('aaa', 'draft', '2026-06-01T00:00:00Z'),
      ])?.id,
    ).toBe('aaa');
  });
  it('never picks a discarded inspection', () => {
    expect(
      pickCanonicalInspection([
        insp('x', 'discarded', '2026-01-01T00:00:00Z'),
        insp('y', 'draft', '2026-06-01T00:00:00Z'),
      ])?.id,
    ).toBe('y');
    expect(pickCanonicalInspection([insp('x', 'discarded', '2026-01-01T00:00:00Z')])).toBeUndefined();
  });
});
```

Run: `npx vitest run --pool=forks src/lib/firstVisit/__tests__/canonicalInspection.test.ts` → FAIL (module missing).

**Step 2: Implement**

```ts
// The ONE shared visit per deal: every device must resolve the same inspection
// for a deal, deterministically, even while prod still holds pre-cleanup
// duplicates. Rule: submitted beats draft (a submitted visit holds the real
// data), then earliest started_at (dupes are later cold-device re-creations),
// then lowest id as a total-order tiebreak. Discarded rows never win.
export function pickCanonicalInspection<
  T extends { id: string; status: 'draft' | 'submitted' | 'discarded'; started_at: string },
>(inspections: T[]): T | undefined {
  return inspections
    .filter((i) => i.status !== 'discarded')
    .sort(
      (a, b) =>
        (a.status === 'submitted' ? 0 : 1) - (b.status === 'submitted' ? 0 : 1) ||
        a.started_at.localeCompare(b.started_at) ||
        a.id.localeCompare(b.id),
    )[0];
}
```

**Step 3: Run the test** → PASS. Commit:

```bash
git add src/lib/firstVisit/canonicalInspection.ts src/lib/firstVisit/__tests__/canonicalInspection.test.ts
git commit -m "feat(fv): deterministic canonical-inspection rule for one-visit-per-deal"
```

---

## Task 2: Extract `resumeOrStartVisit` into a lib with hub-first resolution

**Files:**
- Create: `src/lib/firstVisit/resumeOrStartVisit.ts`
- Create: `src/lib/firstVisit/__tests__/resumeOrStartVisit.test.ts`
- Modify: `src/app/first-visit/new/DealPicker.tsx` (delete the local copy at lines 8-34; import the lib)

**Step 1: Write the failing tests** (fake-indexeddb is the repo pattern — mirror the setup in `src/lib/firstVisit/__tests__/restore.test.ts`; mock `./restore`, `./sync`, `./analytics`):

```ts
vi.mock('@/lib/firstVisit/restore', () => ({ restoreFromCloud: vi.fn() }));
vi.mock('@/lib/firstVisit/sync', () => ({ enqueue: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/firstVisit/analytics', () => ({ track: vi.fn() }));
```

Cases (each clears `localDb.inspections` in `beforeEach`):
1. **Hydrates from the hub before resolving:** `restoreFromCloud` resolves and (via the mock) seeds a hub inspection for the deal into Dexie → returns that id, `resumed: true`, no `enqueue` call, no new row.
2. **Resumes a SUBMITTED visit** (decision 3): the only inspection for the deal has `status: 'submitted'` → its id is returned, no create.
3. **Picks the canonical among duplicates:** seed one submitted + two drafts for the deal → returns the submitted one (delegation to `pickCanonicalInspection`).
4. **Offline fallback:** `restoreFromCloud` rejects → still resumes the local draft; and with an empty local store, creates a new inspection (UUID, `status:'draft'`) and enqueues exactly one `inspection_upsert`.
5. **Creates only when hub AND local have none:** `restoreFromCloud` resolves, Dexie stays empty → creates + enqueues + returns `resumed: false`.
6. **Idempotent on repeat selection:** calling twice returns the same id and enqueues only once.

Run: `npx vitest run --pool=forks src/lib/firstVisit/__tests__/resumeOrStartVisit.test.ts` → FAIL (module missing).

**Step 2: Implement `src/lib/firstVisit/resumeOrStartVisit.ts`**

```ts
import { localDb } from './db';
import { enqueue } from './sync';
import { restoreFromCloud } from './restore';
import { pickCanonicalInspection } from './canonicalInspection';
import { track } from './analytics';

// Each deal has exactly ONE shared inspection across all staff (2026-07-09
// decision — 13 dupes on one prod deal came from resolving against local Dexie
// only). Resolution order:
//   1. Best-effort hub hydration (restoreFromCloud) so a cold/evicted/second
//      device and a deep-linked /first-visit/new see every hub visit WITH its
//      targets and answers — offline, the throw is swallowed and we resolve
//      against whatever this device already has.
//   2. Pick the canonical non-discarded inspection for the deal (submitted >
//      draft, then earliest started_at, then lowest id) — deterministic on
//      every device, tolerant of pre-cleanup duplicates. Submitted visits are
//      REOPENABLE: selecting the deal resumes them for editing.
//   3. Create only when hub AND local have none. A simultaneous create on two
//      devices can still race; the canonical rule reconverges every later
//      selection onto one winner and the loser is cleaned up out-of-band.
export async function resumeOrStartVisit(
  dealId: string,
): Promise<{ id: string; resumed: boolean }> {
  await restoreFromCloud().catch(() => {}); // offline / expired session → local-only
  const existing = await localDb.inspections.where('deal_id').equals(dealId).toArray();
  const canonical = pickCanonicalInspection(existing);
  if (canonical) return { id: canonical.id, resumed: true };

  const id = crypto.randomUUID();
  const inspection = {
    id,
    deal_id: dealId,
    status: 'draft' as const,
    inspector_email: '', // filled server-side from session
    started_at: new Date().toISOString(),
  };
  await localDb.inspections.put(inspection);
  await enqueue('inspection_upsert', inspection);
  track('first_visit_started', { inspection_id: id, deal_id: dealId });
  return { id, resumed: false };
}
```

In `DealPicker.tsx`: delete lines 8-34 (the module-private function + its comment), drop the now-unused `localDb`/`enqueue` imports, and `import { resumeOrStartVisit } from '@/lib/firstVisit/resumeOrStartVisit';`. `pickDeal` is unchanged.

**Step 3: Run the test** → PASS. Also run `npx vitest run --pool=forks src/lib/firstVisit/__tests__/restore.test.ts` (unchanged, must stay green).

**Step 4: Commit**

```bash
git add src/lib/firstVisit/resumeOrStartVisit.ts src/lib/firstVisit/__tests__/resumeOrStartVisit.test.ts src/app/first-visit/new/DealPicker.tsx
git commit -m "feat(fv): deal selection resolves the one shared hub visit; stops minting duplicates

resumeOrStartVisit now hydrates from the hub first (offline falls back to
local), resumes the canonical non-discarded inspection for the deal —
including SUBMITTED ones, which are now reopenable — and creates only when
hub and local both have none."
```

---

## Task 3: Pin submit-route re-runnability (test-only unless it fails)

**Files:**
- Modify: `src/app/api/first-visit/submit/__tests__/route.test.ts`
- Modify (only if the test exposes a gap): `src/app/api/first-visit/submit/route.ts`

**Step 1: Add a pinning test** (reuse the file's existing mock helpers):

```ts
it('re-runs cleanly on an already-submitted inspection: re-pushes values and refreshes submitted_at', async () => {
  // Same seed as the first test; the route must not reject based on status.
  // Assert: 200 { ok: true }, data_point_values upsert called again, and the
  // final inspections.update sets status 'submitted' with a NEW submitted_at.
});
```

**Step 2: Run** `npx vitest run --pool=forks src/app/api/first-visit/submit/__tests__/route.test.ts`.
Expected: **PASS with no route change** — the route has no status gate, the `data_point_values` writes are conflict-keyed upserts, and the closing update re-marks submitted (verified in `route.ts:29-34, 70-92, 173-177`). If it fails, make the minimal fix only (no Batch G hardening — no drain-gating, no `resubmit` flag).

**Step 3: Commit**

```bash
git add src/app/api/first-visit/submit/__tests__/route.test.ts
git commit -m "test(fv): pin submit route re-runnability for reopenable visits"
```

---

## Task 4: Reopen-for-editing UX in VisitNavigator

Local status **stays `'submitted'`** on reopen (no flip to draft): answers keep syncing (no gate on `POST /api/first-visit/answers`), `restore.ts`'s draft→submitted upgrade can't fight it, and `sync.ts`'s `ensureInspectionQueued` submitted-skip stays exactly as-is (it correctly protects hub status from a stale `inspection_upsert`; a submitted inspection by definition already has its hub parent row, so the self-heal it skips is unneeded).

**Files:**
- Modify: `src/app/first-visit/[dealId]/[inspectionId]/VisitNavigator.tsx`
- Modify: `src/app/first-visit/[dealId]/[inspectionId]/__tests__/VisitNavigator.submit.test.tsx`

**Step 1: Write the failing tests** (extend `VisitNavigator.submit.test.tsx`; parameterize the inspection status in the seed helper):

```ts
it('shows Re-submit for a submitted visit and reopen-friendly dialog copy', async () => {
  await seedProperty('submitted');
  render(<VisitNavigator dealId={DEAL} inspectionId={INSPECTION} ... />);
  const btn = await screen.findByRole('button', { name: 'Re-submit visit' });
  fireEvent.click(btn);
  const dialog = await screen.findByRole('dialog');
  // The old lock contract is gone:
  expect(within(dialog).queryByText(/will not be able to edit/i)).toBeNull();
  // The new contract is stated:
  expect(within(dialog).getByText(/reopen and edit .* any time/i)).toBeInTheDocument();
  // Confirm re-submits (dialog button mirrors the page label):
  fireEvent.click(within(dialog).getByRole('button', { name: 'Re-submit visit' }));
  await waitFor(() => expect(screen.getByText(/Visit submitted/i)).toBeInTheDocument());
});
```

Also assert in the existing draft-path test that the new copy line renders there too (same dialog).

Run: `npx vitest run --pool=forks "src/app/first-visit/[dealId]/[inspectionId]/__tests__/VisitNavigator.submit.test.tsx"` → FAIL.

**Step 2: Implement in `VisitNavigator.tsx`:**

1. Load the inspection row: `const [inspection, setInspection] = useState<LocalInspection | null>(null)` hydrated in the mount effect (`localDb.inspections.get(inspectionId)`), refreshed after `confirmSubmit`. Derive `const isResubmit = inspection?.status === 'submitted';`.
2. Page submit button (~line 641-646): label `{isResubmit ? 'Re-submit visit' : 'Submit visit'}`.
3. `confirmSubmit` (~line 399): unchanged logic — add `resubmit: isResubmit` to the `submit_clicked` track payload and refresh the inspection state after the update.
4. `SubmitDialog` (~line 664-750): accept a `resubmit: boolean` prop.
   - Replace *"You will not be able to edit this visit after submitting."* with: **"You can reopen and edit this visit at any time — re-submitting updates the hub with your latest answers."**
   - Confirm button label mirrors the page (`Re-submit visit` / `Submit visit`).
   - Success pane: keep "Visit submitted"; body copy → "Your answers are saved and syncing to the hub. You can reopen this visit later to make changes."

No `UnitSurvey` change (verified: no status gating exists). No `MyVisits` change required; **optional, if cheap:** append "· tap to reopen" to the status line for submitted rows — do NOT restructure the list or ordering.

**Step 3: Run the navigator test file** → PASS.

**Step 4: Commit**

```bash
git add "src/app/first-visit/[dealId]/[inspectionId]/VisitNavigator.tsx" "src/app/first-visit/[dealId]/[inspectionId]/__tests__/VisitNavigator.submit.test.tsx"
git commit -m "feat(fv): submitted visits are reopenable — Re-submit flow + new dialog contract

Local status stays 'submitted' on reopen; answer edits sync as normal and
re-submit re-runs the idempotent push. Removes the 'you will not be able to
edit' contract."
```

---

## Task 5: Full verification

1. `npx tsc --noEmit` → clean (this is what typechecks the new test files).
2. `npx vitest run --pool=forks` (single run) → all green. Watch specifically: `restore.test.ts`, `ensureInspectionQueued.test.ts` (both intentionally unchanged), `sync.test.ts`, the submit route tests, `VisitNavigator.submit.test.tsx`.
3. Manual smoke (two browser profiles against dev): profile A starts a visit on a deal and submits; profile B (fresh IndexedDB) picks the same deal → must land in A's inspection with A's targets/answers visible, button reads "Re-submit visit"; edit an answer in B, re-submit, confirm the hub `data_point_values` reflect the edit. Then, on a deal with multiple prod inspections (e.g. `7854a27e`), confirm selection resolves to the submitted/earliest one every time on both profiles.
4. Push; update PR #29 with a comment: dupes root cause (local-only resolution + draft-only resume), fix (hub-first canonical resolution, reopenable submits), and the canonical rule so the cleanup script (separate, out of scope) can mirror it server-side.
5. Update `MEMORY.md`: one-visit-per-deal shipped; submitted = reopenable; note the accepted rare create-race dupe + that prod cleanup (discard non-canonical via `status='discarded'`) is still pending.

---

## Explicitly out of scope (do NOT build)
- The one-off prod cleanup script (separate task; the code must merely tolerate pre-cleanup duplicates — it does, via `pickCanonicalInspection`).
- Deterministic inspection ids derived from `deal_id` (decision: adopt existing hub ids).
- Submit idempotency hardening / drain-gated submit / "Submit anyway" soft gate (Batch G).
- Re-check-after-create collision handling (accepted rare dupe; deterministic rule reconverges).
- `?deal_id=` filtering on the restore route (only if payload size ever becomes a problem).
- Removing `ensureInspectionQueued`'s submitted-skip or adding status gates to the answers route.

## Test impact summary
- **New:** `canonicalInspection.test.ts`, `resumeOrStartVisit.test.ts`, submit-route re-run pin, VisitNavigator re-submit/copy tests.
- **Breaks expected:** none — no existing DealPicker test; `VisitNavigator.submit.test.tsx` seeds a draft and asserts "Submit visit", preserved for drafts; grep for `will not be able to edit` hits only VisitNavigator.tsx today.
