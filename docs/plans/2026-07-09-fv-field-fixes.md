# First-Visit Field Fixes — Validation & Plan (2026-07-09)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement each batch task-by-task.

Source: field feedback from Abhijeet's first real visits + Joshua. All items below
were **validated** (reproduced / root-caused with code + live hub evidence) before
planning. Live hub read via `HUB_SUPABASE_SERVICE_ROLE_KEY` (REST, `Accept-Profile:
onboarding`, GET only, paginate).

Branch context: `feat/fv-cloud-restore` (PR #29 open). Merges to upstream `main`
auto-deploy to prod (`inspection-app-y517`).

**Testing:** never run >1 vitest at once. `npx vitest run --pool=forks <path>`.
`tsc --noEmit` is the only gate that typechecks test files.

---

## Validated issues + decisions

| # | Issue | Verdict | Decision |
|---|-------|---------|----------|
| 10 | Property/unit tap → "network error" | Chrome renderer **OOM** from full-res remote media (`e052599`) | Thumbnails + tap-to-load. Plan: `2026-07-09-fv-media-oom-fix.md` |
| 11 | Selecting a deal creates duplicate inspections | **Real.** `resumeOrStartVisit` checks LOCAL Dexie only → evicted/cold/2nd device duplicates. Live: 13 inspections on one deal, 5 on Abhi's field deal | **One shared visit per deal**, hub-resolved. Clean up dupes: keep the filled-out one per deal, discard the rest |
| 9 | Progress % wrong | **Real.** Required photo/video questions never count done — progress reads `answers` table, media writes `media` table. Unit ring stuck ~3 short, property ~1 short | Count file questions via the `media` table |
| 2 | Terrace missing | **Real.** Only `fv_unit_balcony_present` exists; no terrace question | Add a terrace question alongside the balcony one |
| 6 | Issue-log location has "Balcony", no terrace | **Real.** `issue_location` (`rows.mjs:393`) lists Balcony only; building log has neither | "Balcony" → "Balcony/Terrace" in unit log; add to building log area |
| 7 | Mandatory general comment | **Real.** `fv_general_comments` (phase 15) is `required:true`; issue-log notes are already optional | Make `fv_general_comments` optional |
| 8 | Missing mandatory fields not highlighted | **Real gap.** Only a static asterisk + submit-dialog list; no per-field/section invalid state | Subtle live marker + strong highlight on submit |
| 3 | Unclear a property needs ≥1 unit | **Real UX gap.** Units fully manual, none auto-created | Auto-create one unit per property |
| 4 | Speed test not working | **Mostly fixed** (`240dd9f`, 2026-07-08). Remaining: speedtest routes not exempt from auth middleware; download route ignores `ckSize` | Exempt routes + honor `ckSize`; verify fix deployed |
| 1 | Sync to hub / other device | **Happy path WORKS** (437 answers landing live; both email domains write). Real latent bugs: silent failures (SyncBadge only shows offline; all errors swallowed) + partial-submit data loss. Today's "not syncing" is a **symptom of #10** (crash blocked data entry) | Surface sync failures + submit safety |
| 5 | "availability type of" | **Ignored per Joshua** | — |

---

## Batch A — OOM crash (#10)
Already designed + planned: `docs/plans/2026-07-09-fv-media-oom-fix.md`. **Ship first.**

---

## Batch B — Survey content (#2, #6, #7)

Low risk; edits to the authoritative source then regenerate. **All three are one PR.**

**Files:**
- Modify: `scripts/redesign/rows.mjs`
- Regenerate: run `node scripts/redesign/gen.mjs` then `npx tsx scripts/gen-survey-snapshot.mjs`
  (updates `src/data/first-visit-content.json`, `src/lib/firstVisit/questionStructure.ts`,
  and the parity snapshot). Do NOT hand-edit the generated files.

**#7 — make general comment optional (trivial):**
- `rows.mjs:422` — change `fv_general_comments` `required: true` → `required: false`.

**#6 — balcony/terrace in issue-log location (DECIDED: separate options):**
- `rows.mjs:393` — unit issue log `issue_location`: keep `'Balcony'`, add `'Terrace'`
  right after it.
- `rows.mjs:203` — building issue log `prop_issue_area`: add `'Balcony'` and
  `'Terrace'` (it currently has neither).
- Option strings are stored values; no migration needed (free-text value column).

**#2 — add a unit terrace question:**
- After `rows.mjs:229` (`fv_unit_balconies_count`), add a terrace present/count pair
  mirroring the balcony ones:
  ```js
  { slug: 'fv_unit_terrace_present', label: 'Is there a terrace?', type: 'boolean', scope: 'unit_category', phase: <same as balcony>, required: <match balcony> },
  { slug: 'fv_unit_terrace_count', label: 'Number of terraces', type: 'number', scope: 'unit_category', phase: <same>, visible_when: { question: 'fv_unit_terrace_present', equals: true } },
  ```
  (Copy the exact field shape/keys from the balcony rows at 227–230 — match `scope`,
  `phase`, `area`, and `required` conventions.)
- **Hub registry IN SCOPE (decided 2026-07-09):** the submit route skips slugs with
  no hub `data_points` registry entry (`if(!dp)continue`), so Batch B includes a
  hub-repo registry migration adding `fv_unit_terrace_present` + `fv_unit_terrace_count`
  (level = unit_category), applied live before/with the app deploy — same pattern as
  migrations 070/071/075/081. Check whether #6's option rename needs a registry
  touch (issue_location values are free-text into fv_issues, likely no).

**Steps (TDD-ish):**
1. Check the survey parity test exists (`scripts/gen-survey-snapshot`); note it will
   need regenerating after the change.
2. Edit `rows.mjs` for #7, #6, #2.
3. Run `node scripts/redesign/gen.mjs` + `npx tsx scripts/gen-survey-snapshot.mjs`.
4. `npx tsc --noEmit` and `npx vitest run --pool=forks` (fix any snapshot/count tests
   — question count changes from 145 → 147).
5. Commit.

---

## Batch C — Deal → one shared visit per deal (#11)

**Model (decided):** each deal has exactly ONE inspection, shared across staff.
Selecting a deal resolves to it via the hub; create only if none exists.

**Two parts: (1) code fix so no new dupes, (2) one-time prod cleanup.**

### C1 — Resolve the canonical inspection from the hub
**Files:**
- Modify: `src/app/first-visit/new/DealPicker.tsx` (`resumeOrStartVisit`, DealPicker.tsx:11)
- Likely add: a route or lib call to look up the hub inspection for a deal
  (`src/app/api/first-visit/inspections/*` or reuse restore data). Investigate
  existing `src/app/api/first-visit/inspections` before adding.

**Approach:**
- `resumeOrStartVisit(dealId)` must, when online, ask the hub for the existing
  (non-discarded) inspection for `dealId` and resume it (write it into local Dexie
  if absent) instead of minting a new UUID. Only create when the hub has none.
- Guard the create path against a race: if creation collides with an existing
  hub row for the deal, prefer the existing one.
- Offline fallback: keep the local-resume behavior, but on next online load the
  shared-visit reconciliation (restore) should converge; ensure we don't strand a
  local-only duplicate. Consider: creation should be deterministic per deal, OR the
  restore/merge should de-dupe by deal_id.
- ⚠️ Open sub-question to resolve at implementation: the current model keys a visit
  by `inspection_id`; "one per deal" effectively makes `deal_id` the identity. Decide
  whether to (a) query hub for `min(started_at)`/submitted inspection per deal and
  adopt its id, or (b) derive a deterministic inspection id from deal_id. (a) is
  safer with existing data.

**Tests:** unit-test `resumeOrStartVisit` resolves to the hub inspection when local
is empty (mock the lookup); creates only when none exists; is idempotent on repeat
selection.

### C2 — Prod cleanup (keep the filled-out one)
- One-off script (scratchpad, not committed to app) using the service key:
  for each deal with >1 inspection, keep the one with the most answers (ties →
  submitted, then earliest `started_at`); set the others to `status='discarded'`
  (the restore route already filters out discarded, so they vanish from all devices).
  Do NOT hard-delete (golden rule: nothing is destroyed; discard is reversible).
- Preview first (dry run: list keep/discard per deal), show Joshua, then execute.
- Deals affected (live 2026-07-09): `85601289` (13), `7854a27e` (5, keep `010839f4`
  submitted/195 answers), `f4288219` (4), `d3b3a817` (2).

---

## Batch D — Progress % counts media (#9)

**Root cause:** required `type:'file'` questions can never be "done" — progress reads
the `answers` table; media writes only the `media` table.

**Files:**
- Modify: `src/lib/firstVisit/progress.ts` (`computeProgressFromAnswers` ~:55;
  `remainingRequiredForTarget` ~:84)
- Modify: `src/app/first-visit/[dealId]/[inspectionId]/UnitSurvey.tsx`
  (`requiredStats` ~:437, section dots ~:611)
- Test: `src/lib/firstVisit/__tests__/progress.test.ts`

**Approach (decide one):**
- **Option A (preferred):** pass the set of media-answered keys into the progress
  functions. Progress signature gains an optional `mediaKeys: Set<string>` (target +
  area + question). A required file question counts done if it has a media row for its
  tuple. UnitSurvey already loads media via MediaGallery/`localDb.media` — compute the
  key set there (and in VisitNavigator for the ring, from `localDb.media` for the
  inspection) and pass it in.
- Option B: have media capture also write a sentinel `answers` row (`value:'__media'`)
  — simpler progress, but pollutes answers + sync. Rejected (YAGNI/side-effects).

**Affected required file slugs (standalone, no group_id):** `fv_video_checkin_walkthrough`
(location), `fv_photo_bathroom`, `fv_photo_kitchen`, `fv_photo_general_apartment` (unit).

**Steps:** write failing test (required file question with a media row counts done;
without one, still missing) → thread `mediaKeys` through `progress.ts` → update
UnitSurvey + VisitNavigator callers → tsc + full suite → commit.

---

## Batch E — Required-field highlighting + unit auto-create (#8, #3)

### E1 — Highlight missing required (subtle live + strong on submit)
**Files:**
- Modify: `src/components/firstVisit/PrefilledField.tsx` (asterisk ~:261, :541),
  `StepGroup.tsx` (~:294)
- Modify: `src/app/first-visit/[dealId]/[inspectionId]/UnitSurvey.tsx` (section chips
  ~:617-646; add a submit-attempt flag) and the submit path in `VisitNavigator.tsx`
- Reuse: `progress.ts` signals (`requiredVisible`, `isAnswered`, `isVisible`)

**Approach:**
- Add a per-field "missing" state = required && visible && !answered (and, for files,
  no media — depends on Batch D's key set).
- **Live (subtle):** a muted amber marker / hint on empty required fields.
- **On submit attempt (strong):** set a `submitAttempted` flag when the inspector
  hits Submit; escalate empty required fields to a red border + `aria-invalid`, and
  mark sections with outstanding required items on the chips. Scroll to / expand the
  first missing.
- Keep the submit dialog list (already good).

**Tests:** field renders neutral/subtle when empty pre-submit; red + aria-invalid
after submit attempt; answered required field never shows missing; section chip shows
incomplete marker when it has outstanding required.

### E2 — Auto-create one unit per property (#3)
**Files:**
- Modify: `src/app/first-visit/[dealId]/[inspectionId]/VisitNavigator.tsx`
  (`addPropertyFromHub` ~:296, `addPropertyOnSite` ~:311)

**Approach:**
- After a property is created (both hub-pick and on-site paths), auto-create one child
  unit (reuse `addUnitFromHub`/`addUnitOnSite` logic or a shared `createUnit` helper).
  For a hub property with hub units, seed the first hub unit; otherwise create a blank
  on-site unit the inspector renames (respect the identifier-required gate — an
  auto-created blank unit must be renamable, and `openUnit` already blocks opening an
  unnamed unit, so prompt rename).
- ⚠️ Decide: auto-seed a *named* unit (e.g. "Unit 1") so it's openable immediately,
  vs a blank that forces rename. Recommend **"Unit 1"** default label to avoid the
  open-blocked-on-rename friction.

**Tests:** adding a property yields exactly one child unit; the unit is openable
(has a label); no duplicate seeding on re-render.

---

## Batch F — Speed test (#4)

**Files:**
- Modify: `middleware.ts` (early-allow block ~:14-21, matcher ~:58-60)
- Modify: `src/app/api/first-visit/speedtest/download/route.ts` (~:5-7)
- Test: `src/app/api/first-visit/speedtest/download/__tests__/route.test.ts`

**Approach:**
1. First verify `240dd9f` is on prod (if not, that alone was the field failure).
2. Exempt `/api/first-visit/speedtest/*` (and `/vendor/*`) from the Supabase
   `getUser()` middleware so throughput isn't measured through an auth round-trip.
3. Download route: honor LibreSpeed's `ckSize` param (it never sends `bytes`), so a
   fast link gets a large-enough stream to measure. Cap sensibly.

**Tests:** download route returns a stream sized by `ckSize`; middleware lets a
speedtest request through without a session. tsc + suite → commit.

---

## Batch G — Sync visibility + submit safety + immediate push (#1, #12)

Overlaps known batch-3 debt (see MEMORY.md open bugs). **Med-high risk; do last.**

**Files:**
- `src/components/firstVisit/SyncBadge.tsx` (only shows offline ~:13)
- `src/lib/firstVisit/useSyncEngine.ts` (swallows errors ~:53,59,62),
  `sync.ts` (per-job swallow ~:43; expose `attempts`/`last_error`)
- `src/app/first-visit/[dealId]/[inspectionId]/VisitNavigator.tsx` (`confirmSubmit`
  ~:402-408), `src/app/api/first-visit/submit/route.ts`

**Approach:**
- **Visibility:** SyncBadge shows a failing state when online with jobs that have
  `attempts>0`/`last_error`; surface a count + last error somewhere non-blocking.
- **Submit safety (DECIDED 2026-07-09 — both):**
  1. **Gate submit on a drained outbox** (primary): on Submit, drain first and only
     enqueue the `submit` job once this inspection's pending answer jobs have landed;
     if jobs are stuck, show "X answers haven't reached the hub yet" + retry instead
     of silently submitting a partial visit.
  2. **Make submit re-runnable** (safety net): allow re-running the submit route on
     an already-submitted inspection — the `data_point_values` push is an upsert, so
     a re-run heals late-arriving answers instead of losing them permanently.
  Rationale: the gate prevents the failure; idempotent re-run recovers from anything
  that slips past it (offline edge cases, days-later devices).
- **#12 — Immediate push on entry (Joshua, 2026-07-09):** every entered answer should
  reach the hub right away, not on the 30 s drain cycle. Keep the local-first write +
  outbox (offline must keep working), but trigger `drainOutbox` immediately on every
  `enqueue` when online, debounced ~1–2 s so rapid typing batches into one push. Keep
  the 30 s interval + focus/online triggers as the retry/fallback path. Likely change:
  `sync.ts` `enqueue()` fires a debounced drain (or emits an event `useSyncEngine`
  listens to). Also mount the sync engine (or at least a drain trigger) on the visits
  list page — today it only lives in VisitNavigator, so jobs queued elsewhere sit
  until a survey is opened.

**Tests:** SyncBadge failing state when online+errored; submit blocked/warned with
pending jobs.

---

## Recommended sequence
1. **Batch A (#10)** — ship immediately (field-blocking, masks #1).
2. **Batch B (#2/#6/#7)** — quick content wins (resolve hub-migration scope for #2).
3. **Batch C (#11)** — stop dupes + clean prod.
4. **Batch D (#9)** — progress correctness.
5. **Batch E (#8/#3)** — required UX.
6. **Batch F (#4)** — speed test.
7. **Batch G (#1)** — sync visibility/submit safety (confirm approach first).

## All open items DECIDED (2026-07-09, second round with Joshua)
- #2/#6 hub registry migration in scope for #2; #6 = separate 'Terrace' option (unit
  log keeps 'Balcony' + adds 'Terrace'; building log adds BOTH).
- #2 terrace questions mirror the balcony pair exactly (present yes/no + count on
  yes, same phase/required-ness).
- #11 C1 identity: adopt the existing hub inspection id per deal (canonical after
  cleanup). Cleanup: keep the filled-out inspection per deal, discard the rest —
  NO answer merging (properties/units are easy to re-add). Dry-run shown first.
- **After-submit rule (NEW): submitted visits are REOPENABLE for editing** and can
  be re-submitted (pairs with Batch G's idempotent re-runnable submit). This changes
  the current "You will not be able to edit this visit after submitting" copy + the
  submitted-lock behavior — implement in Batch C alongside one-visit-per-deal.
- #3 auto-created unit default label: "Unit 1".
- #1 submit gate: SOFT block — "X answers haven't reached the hub yet" + Retry, with
  an explicit "Submit anyway" override; re-runnable submit heals stragglers.
- Sequencing: Batch B starts immediately; no hold for field confirmation of Batch A.
