# First-Visit Survey — Full-Pipeline Bug Review (Design)

Date: 2026-07-07
Status: approved (Option A)

## Context

- Local branch `deploy-merged3` == `upstream/main` == the production deployment
  (`inspection-app-y517.vercel.app`, built 2026-06-29 from `a17f083`).
- Working tree additionally holds the uncommitted **property-level issue log**
  ("Building condition & issues", phase 16, `prop_issue_*` slugs) — 8 modified files.
- User questions: are all fields saved? does export work? does data reach the
  onboarding hub? anything else critical?

## Scope

First-visit survey pipeline only, end to end. Includes the uncommitted WIP.
After the review is clean: commit + PR the WIP to upstream.

## Approach: staged pipeline audit with live read-only verification

Review each handoff of the data path with a dedicated agent, in parallel:

1. **Capture** — every field type writes an answer: UnitSurvey save paths,
   repeater rows, media attachments, voice-fill writes (suggestions + summary),
   `visible_when` self-heal clearing. Silent-data-loss hotspots.
2. **Persistence & sync** — Dexie outbox → `sync.ts` → API routes: cookie auth,
   FK ordering (parent inspection ensure), retry/backoff, offline resume,
   conflict/duplicate handling.
3. **Export** — `findings.csv` route and Everything-ZIP export: coverage of all
   16 phases / 145 questions, `prop_issue_*` handling, media references.
4. **Hub handoff** — submit route vs live `onboarding.data_points` registry
   (read-only REST via service key): every emitted slug must have a definition,
   because the submit route silently drops unknown slugs. Verify the 11
   building-issue definitions (hub migration 075) are applied live.
5. **WIP diff review** — focused correctness review of the uncommitted
   building-issues changes; full vitest suite run (single run, `--pool=forks`).

All findings are adversarially verified before reporting. No writes to prod.

## Deliverables

1. Findings report ranked by severity, each with concrete failure scenario.
2. Fixes for confirmed bugs (after user sees the report, per repo norms —
   quick obvious fixes in the WIP may be folded in before commit).
3. Commit + cross-fork PR of the building-issues WIP to `iuliia-arbio/inspection-app`.

## Non-goals

- No review of hub-repo (Onboarding_tool) code beyond the registry check.
- No PMS push verification (hub-side task, tracked separately).
- No writes to production data.
