# First-Visit UX Bug Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 16 verified issues from `docs/plans/2026-07-07-fv-ux-bug-triage-design.md` — survey content reorganization, voice/media UI fixes, a new wifi speed-test feature, check-in lock gating, and an export/CSV readability fix.

**Architecture:** The survey's questions live in one authoritative source (`scripts/redesign/rows.mjs`) that gets compiled by `node scripts/redesign/gen.mjs` into `src/data/first-visit-content.json` (editor content) and `src/lib/firstVisit/questionStructure.ts` (wiring overlay). Most of these fixes are edits to that one source file, regenerated and verified by the existing test suite (`npm test`) plus a snapshot fixture regenerated via `npx tsx scripts/gen-survey-snapshot.mjs`. The remaining fixes are self-contained UI/component changes, one new feature (wifi speed test via LibreSpeed), and one export-format fix.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest + Testing Library (jsdom, fake-indexeddb), Dexie.

**Sequencing:** 5 chunks, each independently shippable. Chunk A (content-only) should land first since B, C's UI changes are easiest to verify against the post-A content. Chunk D (check-in) is the largest/riskiest — do it last among the content chunks, on its own branch.

- **Chunk A** — Survey content reorganization (rows.mjs edits, one regen+test cycle per task)
- **Chunk B** — UI component fixes (voice button placement, media duplicate/indicator, multi-select exclusivity root cause, scope badge, tap targets)
- **Chunk C** — Wifi speed test (LibreSpeed integration)
- **Chunk D** — Check-in step lock gating + photo + building/unit split
- **Chunk E** — Export ZIP fix (drop manifest, human-readable CSV)

---

## Chunk A: Survey content reorganization

All tasks in this chunk edit `scripts/redesign/rows.mjs` only. After **every** task: regenerate, refresh the snapshot fixture, run the full test suite before committing — the existing guard tests (`parity.test.ts`, `section-voice-prompts.test.ts`, `validateSurveyContent`) will catch drift automatically.

**Regenerate/verify commands (used after every task in this chunk):**
```bash
node scripts/redesign/gen.mjs
npx tsx scripts/gen-survey-snapshot.mjs
npx vitest run --pool=forks
```
Per project convention, only ever run one vitest process at a time.

### Task A1: Move wifi questions to unit level

**Files:**
- Modify: `scripts/redesign/rows.mjs` (phase `'7'`, lines 182-199)

**Step 1: Edit the phase**

Change `scope: 'location'` to `scope: 'unit_category'` on phase `'7'`:

```js
// ── 7 · WiFi (unit_category) ──────────────────────────────────────────────
{ id: '7', label: 'WiFi', scope: 'unit_category', questions: [
  { slug: 'fv_wifi_present', label: 'Wi-Fi available?', type: 'boolean', options: YESNO, required: true,
    description: 'Gate: when "No", WiFi sub-questions collapse.' },
  { slug: 'fv_wifi_ssid', label: 'WiFi network name (SSID)', type: 'text', required: false,
    visible_when: { question: 'fv_wifi_present', equals: true } },
  { slug: 'fv_wifi_password', label: 'WiFi password', type: 'text', required: false,
    visible_when: { question: 'fv_wifi_present', equals: true } },
  { slug: 'fv_wifi_download_speed_mbps', label: 'WiFi download speed (Mbps)', type: 'number', required: false,
    visible_when: { question: 'fv_wifi_present', equals: true } },
  { slug: 'fv_wifi_upload_speed_mbps', label: 'WiFi upload speed (Mbps)', type: 'number', required: false,
    visible_when: { question: 'fv_wifi_present', equals: true } },
  { slug: 'fv_wifi_router_location', label: 'WiFi router physical location', type: 'text', required: false,
    visible_when: { question: 'fv_wifi_present', equals: true } },
  { slug: 'fv_wifi_guest_router_access', label: 'Guest access to router?', type: 'boolean', options: YESNO, required: false,
    visible_when: { question: 'fv_wifi_present', equals: true } },
]},
```

Only the `scope` value and the comment change — question bodies are untouched.

**Step 2: Move the phase's position in the `PHASES` array**

Cut the entire phase `'7'` block out of its current location (between phase `'6'` Cleaning & laundry and phase `'16'` Building condition & issues) and paste it into the unit block, positioned right after phase `'9'` (Unit capacity) and before phase `'10'` (Unit condition & issues). Array order drives render order, not the `id` string, so keeping `id: '7'` is fine (matches the existing convention noted in the phase-16 comment).

**Step 3: Regenerate and verify**

```bash
node scripts/redesign/gen.mjs
npx tsx scripts/gen-survey-snapshot.mjs
npx vitest run --pool=forks
```
Expected: all tests pass. If `parity.test.ts` fails, it means the snapshot fixture wasn't regenerated — re-run step 3's second command.

Check `src/lib/firstVisit/questionStructure.ts` after regen: confirm `fv_wifi_download_speed_mbps` / `fv_wifi_upload_speed_mbps` still carry their `pms_target: 'profile.wifiDetails.downloadSpeedMbps'` / `uploadSpeedMbps` entries (from `scripts/redesign/pms.mjs:76-77`, keyed by slug — unaffected by scope, but confirm by grep after regen: `grep wifiDetails src/lib/firstVisit/questionStructure.ts`).

**Step 4: Commit**

```bash
git add scripts/redesign/rows.mjs src/data/first-visit-content.json src/lib/firstVisit/questionStructure.ts src/lib/firstVisit/__tests__/__fixtures__/all-questions.snapshot.json
git commit -m "feat(fv): move wifi questions from building to unit scope"
```

No code changes needed in `CopyFromUnitPicker.tsx` / `UnitSurvey.tsx:213-239` — `copyAnswersFromUnit` already copies every unit-scoped answer generically once wifi answers are keyed by unit `target_id`.

---

### Task A2: Add section voice-fill to building issues

**Files:**
- Modify: `src/data/section-voice-prompts.ts` (add an entry for phase `'16'`)

**Step 1: Write the addition**

Add a new top-level entry to `SECTION_VOICE_PROMPTS`, mirroring the existing `p10_issues` entry shape (see line ~260) but targeting the `prop_issue_*` fields:

```ts
  // 16 · Building condition & issues
  '16': [
    {
      id: 'p16_issues',
      label:
        'Go issue by issue — for each: what it is, the type, the area of the building, how to resolve it, quantity, rough cost, how urgent, and any notes.',
      target_slugs: [
        'prop_issue_name',
        'prop_issue_type',
        'prop_issue_area',
        'prop_issue_resolution',
        'prop_issue_quantity',
        'prop_issue_cost_estimate_eur',
        'prop_issue_urgency',
        'prop_issue_notes',
      ],
    },
  ],
```

Place it after the `'15'` entry (end of the object), matching the existing ordering-by-phase-number convention.

**Step 2: Run the guard test**

```bash
npx vitest run src/lib/firstVisit/__tests__/section-voice-prompts.test.ts
```
Expected: PASS — `prop_issue_*` slugs already exist in phase `16` per `first-visit-content.json`, so the guard's "every target_slug exists in this phase and is fillable" check passes without needing a content change.

**Step 3: Commit**

```bash
git add src/data/section-voice-prompts.ts
git commit -m "feat(fv): add section voice-fill to building issue log"
```

---

### Task A3: Remove misleading parking AI description

**Files:**
- Modify: `scripts/redesign/rows.mjs` (line 57-58)

**Step 1: Edit**

```js
{ slug: 'fv_parking_nearby_options', label: 'Nearby parking options', type: 'text', required: false },
```
(drop the `description` field entirely — no automation exists to describe)

**Step 2: Regenerate and verify** (see chunk-A commands above)

**Step 3: Commit**
```bash
git add scripts/redesign/rows.mjs src/data/first-visit-content.json src/lib/firstVisit/questionStructure.ts
git commit -m "fix(fv): remove misleading AI-generated claim from parking description"
```

---

### Task A4: Translate building amenities to English

**Files:**
- Modify: `scripts/redesign/rows.mjs` (line 67-68)

**Step 1: Edit**

```js
{ slug: 'fv_building_amenities_verify', label: 'Building amenities', type: 'select', multi_select: true, allow_custom_options: true,
  options: ['Elevator', 'Shared balcony/terrace', 'Shared garden', 'Pool', 'Sauna', 'Gym', 'Conference rooms', 'Reception/Concierge', 'None'], required: true },
```

**Step 2: Regenerate and verify**

**Step 3: Commit**
```bash
git commit -am "fix(fv): translate building amenities options to English"
```

---

### Task A5: Move "Common areas" question out of the fire-safety block

**Files:**
- Modify: `scripts/redesign/rows.mjs` (remove from phase `'5'` line 163-164, insert into phase `'3'` after line 68)

**Step 1: Cut `fv_common_area` from phase `'5'`** (it's currently the last question, right after the fire-safety block)

**Step 2: Paste it into phase `'3'`**, immediately after `fv_building_amenities_verify`:

```js
    { slug: 'fv_building_amenities_verify', label: 'Building amenities', type: 'select', multi_select: true, allow_custom_options: true,
      options: ['Elevator', 'Shared balcony/terrace', 'Shared garden', 'Pool', 'Sauna', 'Gym', 'Conference rooms', 'Reception/Concierge', 'None'], required: true },
    { slug: 'fv_common_area', label: 'Common areas / building facilities', type: 'select', multi_select: true, allow_custom_options: true,
      options: ['Lobby', 'Rooftop', 'Courtyard', 'SmokingArea', 'Storage', 'Shared kitchen', 'Shared garden', 'Other', 'None'], required: false },
```

(This task depends on A4 already having landed, so the amenity options above are already in English — do A4 before A5.)

**Step 3: Regenerate and verify**

**Step 4: Commit**
```bash
git commit -am "fix(fv): move common-area question out of fire-safety block into building exterior phase"
```

---

### Task A6: Remove apartment category question

**Files:**
- Modify: `scripts/redesign/rows.mjs` (phase `'8'`, remove the `fv_apartment_category` block, lines ~241-243)

**Step 1: Delete the question block**

```js
{ slug: 'fv_apartment_category', label: 'Apartment category', type: 'select',
  options: ['Premium', 'Standard', 'Midscale', 'Below standard'], required: true,
  description: 'Tiers anchored on finish quality, furnishing completeness, size and amenities — validate definitions with GX.' },
```
Delete this entire object from phase `'8'`'s `questions` array.

**Step 2: Regenerate and verify.** Confirm no `visible_when` rule anywhere references `fv_apartment_category` (grep first): `grep -n "fv_apartment_category" scripts/redesign/rows.mjs` should return zero results after the edit.

**Step 3: Commit**
```bash
git commit -am "fix(fv): remove apartment category question — determined by hard criteria, not inspector judgment"
```

**Follow-up (not part of this PR):** file a task to deactivate the corresponding hub data-point registry entry (`fv_apartment_category` → PMS target `propertyCategory` per `scripts/redesign/pms.mjs:87`) in the Onboarding Hub app itself.

---

### Task A7: Split and reorder "Unit condition & issues"

This is the largest content task in Chunk A — do it last, after A1–A6 have landed, since it touches phase ids that later tasks don't depend on.

**Files:**
- Modify: `scripts/redesign/rows.mjs` (phase `'10'` removed; phase `'11'` gets 3 new leading questions + rename; new phase `'17'` inserted between phases `'14'` and `'15'`)
- Modify: `src/data/section-voice-prompts.ts` (phase `'10'` entry removed/rebuilt into phase `'11'` and new phase `'17'`)

**Step 1: Edit phase `'11'`** — prepend the 3 condition questions and rename the phase label:

```js
  // ── 11 · Unit condition, appliances & amenities (unit_category) ──────────
  { id: '11', label: 'Unit condition, appliances & amenities', scope: 'unit_category', questions: [
    { slug: 'fv_furniture_status', label: 'Furnished to Arbio standard?', type: 'select',
      options: ['Yes fully', 'Mostly', 'No significant', 'No overhaul'], required: true,
      description: 'Arbio standard: required furniture set (bed, seating, dining, storage), condition/quality, completeness vs the checklist — validate with GX.' },
    { slug: 'fv_equipment_status', label: 'Equipment status', type: 'select',
      options: ['Meets standard', 'Minor additions', 'Significant additions'], required: true,
      description: 'Against the equipment checklist: kitchen equipment completeness, appliances working, essentials present.' },
    { slug: 'fv_bathroom_condition', label: 'Bathroom condition', type: 'select',
      options: ['Excellent', 'Good', 'Needs minor', 'Needs renovation'], required: true,
      description: 'What excellent means: cleanliness; fixtures working; sealing/grout intact; ventilation; no mold or leaks.' },
    { slug: 'fv_items_to_log', label: 'Any appliances/amenities to log?', type: 'boolean', options: YESNO, required: false,
      description: 'Gate for the item log (separate from the issue log).' },
    // ...rest of phase 11's existing questions, unchanged...
  ]},
```

**Step 2: Delete phase `'10'` entirely**, except for the issue-log fields, which move to a new phase.

**Step 3: Insert a new phase between `'14'` (Unit photos & videos) and `'15'` (Final assessment / readiness)**:

```js
  // ── 17 · Unit issue log (unit_category) ───────────────────────────────────
  // Mirrors phase 16 (Building condition & issues): the issue log is the last
  // substantive thing done for a unit, right before final assessment.
  { id: '17', label: 'Unit issue log', scope: 'unit_category', questions: [
    { slug: 'fv_issues_found', label: 'Any issues found in the unit?', type: 'boolean', options: YESNO, required: true,
      description: 'Gate for the unified issue log.' },
    { slug: 'issue_name', label: 'Issue / item name', type: 'text', required: true, group_id: 'issue',
      description: 'Repeat the block per issue.', visible_when: { question: 'fv_issues_found', equals: true } },
    { slug: 'issue_type', label: 'Issue type', type: 'select',
      options: ['Furniture', 'Equipment', 'Maintenance', 'Other'], required: true, group_id: 'issue',
      visible_when: { question: 'fv_issues_found', equals: true } },
    { slug: 'issue_location', label: 'Location in unit', type: 'select',
      options: ['Kitchen', 'Bathroom', 'Bedroom', 'Living room', 'Hallway', 'Balcony', 'Building/common', 'Other'], required: false, group_id: 'issue',
      visible_when: { question: 'fv_issues_found', equals: true } },
    { slug: 'issue_resolution', label: 'Resolution', type: 'select',
      options: ['Buy', 'Fix', 'Replace', 'Monitor'], required: true, group_id: 'issue',
      visible_when: { question: 'fv_issues_found', equals: true } },
    { slug: 'issue_quantity', label: 'Quantity', type: 'number', required: false, group_id: 'issue',
      visible_when: { question: 'fv_issues_found', equals: true } },
    { slug: 'issue_cost_estimate_eur', label: 'Cost estimate (€)', type: 'number', required: false, group_id: 'issue',
      visible_when: { question: 'fv_issues_found', equals: true } },
    { slug: 'issue_urgency', label: 'Urgency', type: 'select',
      options: ['Blocks go-live', 'Nice-to-have'], required: false, group_id: 'issue',
      visible_when: { question: 'fv_issues_found', equals: true } },
    { slug: 'issue_media', label: 'Photo / video of issue', type: 'file', mode: 'observe', required: true, group_id: 'issue',
      visible_when: { question: 'fv_issues_found', equals: true } },
    { slug: 'issue_notes', label: 'Issue notes', type: 'text', required: false, group_id: 'issue',
      visible_when: { question: 'fv_issues_found', equals: true } },
  ]},
```

Field bodies are copy-pasted unchanged from the old phase `'10'` — only their container phase changes.

**Step 4: Update `section-voice-prompts.ts`.** Replace the phase `'10'` entry (`p10_condition` + `p10_issues`) with two edits:

Phase `'11'` gains a new prompt (append to its existing array, don't replace `p11_items`):
```ts
    {
      id: 'p11_condition',
      label:
        'How is the unit overall — is it furnished to Arbio standard, the equipment status, and the bathroom condition?',
      target_slugs: ['fv_furniture_status', 'fv_equipment_status', 'fv_bathroom_condition'],
    },
```
Place it first in phase `'11'`'s array (before `p11_items`) so it's contiguous with the fields it fills, matching the file's existing authoring convention.

New phase `'17'` entry (delete the old `'10'` key entirely, add this one in phase-number order after `'15'`):
```ts
  // 17 · Unit issue log
  '17': [
    {
      id: 'p17_issues',
      label:
        'Are there any issues in the unit? If so, go issue by issue — for each: what it is, the type, where in the unit, how to resolve it, quantity, rough cost, how urgent, and any notes.',
      target_slugs: [
        'fv_issues_found',
        'issue_name',
        'issue_type',
        'issue_location',
        'issue_resolution',
        'issue_quantity',
        'issue_cost_estimate_eur',
        'issue_urgency',
        'issue_notes',
      ],
    },
  ],
```

**Step 5: Regenerate and verify** (chunk-A commands). Pay attention to `section-voice-prompts.test.ts` — it will fail loudly if any slug is missing from its new phase or double-mapped.

**Step 6: Commit**
```bash
git add scripts/redesign/rows.mjs src/data/section-voice-prompts.ts src/data/first-visit-content.json src/lib/firstVisit/questionStructure.ts src/lib/firstVisit/__tests__/__fixtures__/all-questions.snapshot.json
git commit -m "refactor(fv): split unit condition from unit issue log, move issue log to end of unit block"
```

---

## Chunk B: UI component fixes

### Task B1: Move voice-to-text button inside the text field

**Files:**
- Modify: `src/components/firstVisit/PrefilledField.tsx` (text input branch ~line 296-305, textarea branch ~306-313, `VoiceDictation` wrapper ~485-517)
- Test: `src/components/firstVisit/__tests__/PrefilledField.test.tsx` (check if it exists first: `find src/components/firstVisit/__tests__ -iname "PrefilledField*"`)

**Step 1: Restructure the text-field markup.** Wrap the input/textarea and the `VoiceDictation` button in a shared `relative` container, and reposition the button absolutely inside it:

```tsx
{question.type === 'text' && (
  <div className="relative">
    {!isLongText && (
      <input
        id={id}
        ref={textInput.ref as (el: HTMLInputElement | null) => void}
        disabled={isTranscribing}
        className="w-full rounded-md border border-gray-300 px-3 py-2 pr-11 text-base disabled:bg-gray-50 disabled:opacity-60"
        defaultValue={textInput.defaultValue}
        onChange={(e) => textInput.onChange(e.target.value)}
      />
    )}
    {isLongText && (
      <AutoGrowTextarea
        id={id}
        disabled={isTranscribing}
        value={valueStr}
        onChange={emitText}
        className="pr-11"
      />
    )}
    <VoiceDictation
      current={value == null ? '' : String(value)}
      onStatusChange={setDictationStatus}
      onAppended={(next) => {
        onChange({ value: next, wasAcceptedAsIs: false });
        pulseDebounced();
      }}
    />
  </div>
)}
```

Check `AutoGrowTextarea`'s prop signature first (`grep -n "function AutoGrowTextarea" src/components/firstVisit/PrefilledField.tsx`) — add a `className` passthrough prop if it doesn't already forward one, merging it with its existing classes.

**Step 2: Reposition the button inside `VoiceDictation`** (currently `<div className="flex justify-end">`, ~line 507):

```tsx
return (
  <div className="absolute right-1.5 top-1.5">
    <VoiceDictationButton
      status={status}
      online={online}
      elapsedMs={elapsedMs}
      onStart={onStart}
      onStop={onStop}
    />
  </div>
);
```
`top-1.5` pins it near the top for both single-line inputs (where it'll look vertically centered enough given the input's height) and multi-line textareas (where it must not drift down over wrapped text). If the button renders too large for a single-line input's height, adjust to `top-1/2 -translate-y-1/2` for the input case and keep `top-1.5` for the textarea case — verify visually in the browser (see Step 4).

**Step 3: Run existing tests to catch regressions**
```bash
npx vitest run src/components/firstVisit --pool=forks
```
Expected: PASS. If a snapshot/DOM-structure test exists for this component and fails only due to the wrapper div, update that test's query (prefer `getByRole`/`getByLabelText` over structural assertions).

**Step 4: Manually verify in the browser**
```bash
npm run dev
```
Open a First-Visit survey, navigate to any free-text question, confirm the mic icon sits inside the box on the right for both a short single-line field and a multi-line notes field, and that typing doesn't get visually obscured by the icon.

**Step 5: Commit**
```bash
git add src/components/firstVisit/PrefilledField.tsx
git commit -m "fix(fv): move voice-to-text button inside text field instead of below it"
```

---

### Task B2: Fix duplicate media display for file-type questions

**Files:**
- Modify: `src/components/firstVisit/AttachAffordance.tsx`
- Modify: `src/components/firstVisit/StepGroup.tsx:400`
- Test: create `src/components/firstVisit/__tests__/AttachAffordance.test.tsx` if no test file covers this component yet (`find src/components/firstVisit/__tests__ -iname "AttachAffordance*"`)

**Step 1: Write the failing test** (assuming no existing test file — adjust if one exists)

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, queryAllByRole } from '@testing-library/react';
import { AttachAffordance } from '../AttachAffordance';

vi.mock('@/lib/firstVisit/useMediaCapture', () => ({
  useMediaCapture: () => ({ persist: vi.fn(), remove: vi.fn() }),
}));
vi.mock('../MediaGallery', () => ({
  MediaGallery: () => <div data-testid="media-gallery" />,
}));

describe('AttachAffordance hideMedia', () => {
  it('does not render photo/video buttons or the gallery when hideMedia is true', () => {
    render(
      <AttachAffordance
        inspectionId="i"
        targetId="t"
        areaKey="a"
        notes=""
        onNotesChange={vi.fn()}
        hideMedia
      />,
    );
    expect(screen.queryByText('📷 Photo')).not.toBeInTheDocument();
    expect(screen.queryByText('🎥 Video')).not.toBeInTheDocument();
    expect(screen.queryByTestId('media-gallery')).not.toBeInTheDocument();
    // Note capability stays available.
    expect(screen.getByText(/Note/)).toBeInTheDocument();
  });

  it('renders photo/video buttons and the gallery by default', () => {
    render(
      <AttachAffordance
        inspectionId="i"
        targetId="t"
        areaKey="a"
        notes=""
        onNotesChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('media-gallery')).toBeInTheDocument();
  });
});
```

**Step 2: Run it to verify it fails**
```bash
npx vitest run src/components/firstVisit/__tests__/AttachAffordance.test.tsx
```
Expected: FAIL — `hideMedia` prop doesn't exist yet, first assertion's premise (photo button hidden) isn't met since nothing suppresses it.

**Step 3: Implement `hideMedia` in `AttachAffordance.tsx`**

Add the prop to the type and destructuring (line 11-27):
```tsx
export function AttachAffordance({
  inspectionId,
  targetId,
  areaKey,
  questionKey,
  answerId,
  notes,
  onNotesChange,
  hideMedia = false,
}: {
  inspectionId: string;
  targetId: string;
  areaKey: string;
  questionKey?: string;
  answerId?: string;
  notes?: string;
  onNotesChange: (next: string) => void;
  // Suppresses the photo/video capture buttons and the media gallery — used
  // when the sibling question is already type:'file' and has its own
  // MediaButtons capture UI, so this affordance only offers a note.
  hideMedia?: boolean;
}) {
```

Update `compact` (line 61) so it doesn't factor in media state when hidden:
```tsx
const compact = !open && !hasNote && (hideMedia || mediaCount === 0);
```

Wrap the photo/video buttons (lines 110-143) in `{!hideMedia && (...)}`, and wrap the `<MediaGallery>` mount (lines 152-158) plus its 4 hidden `<input>` elements (lines 160-189) in the same guard. Keep the "📝 Note" toggle button (lines 102-109) and the note `<textarea>` (lines 92-99) unconditional.

**Step 4: Wire the flag in `StepGroup.tsx:400`**

```tsx
<AttachAffordance
  inspectionId={inspectionId}
  targetId={targetId}
  areaKey={areaKey}
  questionKey={question.slug}
  answerId={answer?.id}
  notes={answer?.notes}
  onNotesChange={(n) => setNotes(question, n, stepIndex)}
  hideMedia={question.type === 'file'}
/>
```

**Step 5: Run the test again to verify it passes**
```bash
npx vitest run src/components/firstVisit/__tests__/AttachAffordance.test.tsx
```
Expected: PASS.

**Step 6: Commit**
```bash
git add src/components/firstVisit/AttachAffordance.tsx src/components/firstVisit/StepGroup.tsx src/components/firstVisit/__tests__/AttachAffordance.test.tsx
git commit -m "fix(fv): stop rendering duplicate photo/video capture UI on file-type questions"
```

---

### Task B3: Add upload-success indicator to media thumbnails

**Files:**
- Modify: `src/components/firstVisit/MediaGallery.tsx`
- Test: create `src/components/firstVisit/__tests__/MediaGallery.test.tsx` if none exists

**Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { localDb } from '@/lib/firstVisit/db';
import { MediaGallery } from '../MediaGallery';

beforeEach(async () => {
  await localDb.media.clear();
});

describe('MediaGallery upload indicator', () => {
  it('shows an uploading state before uploaded_at is set', async () => {
    await localDb.media.put({
      id: 'm1', inspection_id: 'i', target_id: 't', area_key: 'a',
      kind: 'photo', blob: new Blob(['x']), captured_at: '2026-01-01T00:00:00Z',
    } as Parameters<typeof localDb.media.put>[0]);
    render(<MediaGallery inspectionId="i" targetId="t" areaKey="a" />);
    expect(await screen.findByLabelText(/uploading/i)).toBeInTheDocument();
  });

  it('shows an uploaded checkmark once uploaded_at is set', async () => {
    await localDb.media.put({
      id: 'm2', inspection_id: 'i', target_id: 't', area_key: 'a',
      kind: 'photo', blob: new Blob(['x']), captured_at: '2026-01-01T00:00:00Z',
      uploaded_at: '2026-01-01T00:01:00Z',
    } as Parameters<typeof localDb.media.put>[0]);
    render(<MediaGallery inspectionId="i" targetId="t" areaKey="a" />);
    expect(await screen.findByLabelText(/uploaded/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run to verify it fails**
```bash
npx vitest run src/components/firstVisit/__tests__/MediaGallery.test.tsx
```
Expected: FAIL — neither label exists yet.

**Step 3: Implement the indicator.** Inside the thumbnail `<li>` (line 112-144), add a small badge after the delete button:

```tsx
<li key={row.id} className="relative">
  <button /* ...unchanged thumbnail button... */ />
  {row.uploaded_at ? (
    <span
      aria-label="uploaded"
      title="Uploaded"
      className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] leading-none text-white shadow"
    >
      ✓
    </span>
  ) : (
    <span
      aria-label="uploading"
      title="Uploading…"
      className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-400 text-[9px] leading-none text-white shadow animate-pulse"
    >
      ⏳
    </span>
  )}
  <button /* ...existing delete button... */ />
</li>
```

**Step 4: Run the test again to verify it passes**
```bash
npx vitest run src/components/firstVisit/__tests__/MediaGallery.test.tsx
```
Expected: PASS.

**Step 5: Commit**
```bash
git add src/components/firstVisit/MediaGallery.tsx src/components/firstVisit/__tests__/MediaGallery.test.tsx
git commit -m "feat(fv): show upload status indicator on media thumbnails"
```

---

### Task B4: Fix "None" exclusivity for AI/voice-filled multi-select values

Root cause: `MultiSelectChips.tsx`'s manual tap-to-toggle already enforces "None" exclusivity via `toggleOption()` in `src/lib/firstVisit/multiSelect.ts`. The gap is in `src/lib/firstVisit/validateExtraction.ts:42-54` — AI/voice-fill extraction writes a raw array straight through `normalizeValue()` with no exclusivity check, so a clip that mentions both "no amenities" and "there's a pool" can produce `['None', 'Pool']` and bypass the UI's own rule entirely.

**Files:**
- Modify: `src/lib/firstVisit/validateExtraction.ts:42-54`
- Test: `src/lib/firstVisit/__tests__/validateExtraction.test.ts`

**Step 1: Write the failing test**

Add to the existing test file:
```ts
import { isExclusiveOption } from '../multiSelect';

// ...

it('drops the exclusive option when AI extraction returns both "None" and a real value', () => {
  const TARGET_MULTI = ['fv_building_amenities_verify'];
  const r = validateExtraction(
    {
      singles: {
        fv_building_amenities_verify: { value: ['None', 'Pool'], confidence: 0.8 },
      },
      items: [],
    },
    TARGET_MULTI,
  );
  expect(r.singles.fv_building_amenities_verify.value).toEqual(['Pool']);
});
```
(Confirm `fv_building_amenities_verify` is multi-select in the test's fixture question list — this test's `TARGET` constant only lists slugs; `normalizeValue` looks up `q.multi_select`/`q.options` from `ALL_QUESTIONS` via whatever lookup `validateExtraction` uses internally — check `validateExtraction.ts`'s function signature first to confirm how it resolves `q` for a given slug before finalizing this test's shape.)

**Step 2: Run to verify it fails**
```bash
npx vitest run src/lib/firstVisit/__tests__/validateExtraction.test.ts
```
Expected: FAIL — current code returns `['None', 'Pool']` unchanged (both are valid options, so the existing filter keeps both).

**Step 3: Implement the fix in `normalizeValue`** (`validateExtraction.ts:42-54`)

```ts
import { isExclusiveOption } from './multiSelect';

// ...inside normalizeValue, in the `q.type === 'select' && q.multi_select` branch,
// after computing `kept` (for both the allow_custom_options and standard paths):

if (q.type === 'select' && q.multi_select) {
  if (!Array.isArray(raw)) return null;
  let kept: string[];
  if (q.allow_custom_options) {
    kept = raw
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim());
  } else {
    kept = raw.filter((v) => typeof v === 'string' && q.options.includes(v));
    if (kept.length !== raw.length) warnings.push(`${q.slug}: dropped off-list option(s)`);
  }
  const hasExclusive = kept.some(isExclusiveOption);
  const hasNonExclusive = kept.some((v) => !isExclusiveOption(v));
  if (hasExclusive && hasNonExclusive) {
    warnings.push(`${q.slug}: dropped exclusive option in favor of concrete selections`);
    kept = kept.filter((v) => !isExclusiveOption(v));
  }
  return kept.length ? kept : null;
}
```

Policy choice: when both are present, keep the concrete selections and drop the exclusive one — a voice clip that names an actual amenity is more informative than a default "None," so the specific detection wins.

**Step 4: Run the test again to verify it passes**
```bash
npx vitest run src/lib/firstVisit/__tests__/validateExtraction.test.ts
```
Expected: PASS. Then run the full suite to confirm no other extraction test regressed:
```bash
npx vitest run --pool=forks
```

**Step 5: Commit**
```bash
git add src/lib/firstVisit/validateExtraction.ts src/lib/firstVisit/__tests__/validateExtraction.test.ts
git commit -m "fix(fv): enforce None-exclusivity on AI/voice-filled multi-select answers"
```

---

### Task B5: Reposition the section scope badge

**Files:**
- Modify: `src/app/first-visit/[dealId]/[inspectionId]/UnitSurvey.tsx:648-656`

**Step 1: Read the current header block**
```bash
sed -n '640,660p' "src/app/first-visit/[dealId]/[inspectionId]/UnitSurvey.tsx"
```

**Step 2: Move the badge to its own line below the heading.** The exact current markup wraps heading + badge on one flex row; change it to a `flex-col` wrapper with the heading on its own row and the badge below:

```tsx
<div className="flex flex-col gap-0.5">
  <h2 className="text-lg font-semibold">{phase.label}</h2>
  <span className="w-fit rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600">
    {scopeLabel(scope)}
  </span>
</div>
```
(Adjust exact class names to match what's already there — the only structural change is `flex items-center gap-X` → `flex flex-col gap-0.5`, and adding `w-fit` to the badge so it doesn't stretch full-width.)

**Step 3: Manually verify** in the browser — confirm long phase titles (e.g. "Unit condition, appliances & amenities" from Task A7) no longer crowd the badge.

**Step 4: Commit**
```bash
git add "src/app/first-visit/[dealId]/[inspectionId]/UnitSurvey.tsx"
git commit -m "fix(fv): move section scope badge below heading instead of beside it"
```

---

### Task B6: Bigger tap targets for overview icon buttons

**Files:**
- Modify: `src/app/first-visit/[dealId]/[inspectionId]/VisitNavigator.tsx` (lines ~583-591, ~829-846, ~869-874, ~949-953)

**Step 1: Delete-property button (line 583-591)** — change from `px-2 py-1 text-xs` to a fixed 40×40 target:
```tsx
<button
  type="button"
  onClick={() => deleteProperty(p)}
  title="Delete property"
  aria-label={`Delete ${p.label}`}
  className="flex h-10 w-10 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
>
  🗑
</button>
```

**Step 2: Rename-unit button (line 829-837)** — same treatment:
```tsx
<button
  type="button"
  onClick={onStartRename}
  title="Rename unit"
  aria-label={`Rename ${unit.label}`}
  className="flex h-10 w-10 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
>
  ✎
</button>
```

**Step 3: Delete-unit button (line 838-846)** — same treatment as Step 1's classes.

**Step 4: Add-property trigger (line 869-874)** — this one already has reasonable padding (`px-3 py-2`) but no `min-h`; add one:
```tsx
<button
  onClick={onOpen}
  className="mt-3 min-h-[44px] rounded border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
>
  + Add property
</button>
```

**Step 5: Add-unit trigger (line 949-953)** — currently has no padding at all; give it the same `min-h-[44px]` plus horizontal padding:
```tsx
<button
  onClick={onOpen}
  className="mt-2 min-h-[44px] px-2 text-xs text-gray-500 hover:text-gray-900"
>
  + Add unit
</button>
```

**Step 6: Run existing tests, then verify manually**
```bash
npx vitest run "src/app/first-visit/[dealId]/[inspectionId]" --pool=forks
npm run dev
```
Open the deal overview, confirm all 5 controls are comfortably tappable and visually consistent with the app's existing 40px/44px conventions elsewhere.

**Step 7: Commit**
```bash
git add "src/app/first-visit/[dealId]/[inspectionId]/VisitNavigator.tsx"
git commit -m "fix(fv): increase tap target size for overview delete/rename/add buttons"
```

---

## Chunk C: Wifi speed test (LibreSpeed integration)

**Prerequisite:** Before starting, verify LibreSpeed's license terms are compatible with vendoring into this repo (check github.com/librespeed/speedtest's LICENSE file — confirm whether it's GPL or LGPL, and whether client-side-only usage without redistributing their server changes the analysis). This is a manual verification step, not automatable — do it before writing code, and stop to flag it to Joshua if there's any doubt.

**Files:**
- Create: `src/app/api/first-visit/speedtest/download/route.ts`
- Create: `src/app/api/first-visit/speedtest/upload/route.ts`
- Create: `src/app/api/first-visit/speedtest/ping/route.ts`
- Create: `src/components/firstVisit/WifiSpeedTest.tsx`
- Vendor: LibreSpeed client JS (exact file depends on which release is chosen — likely `speedtest.js` + `speedtest_worker.js` from their `client/dist` — vendor under `src/vendor/librespeed/` or `public/vendor/librespeed/` since it needs to run as a worker script)
- Modify: `src/data/first-visit-content.json` is NOT touched directly (it's generated) — no rows.mjs change needed since this doesn't add a new question, it adds a UI affordance next to the two existing number fields
- Modify: wherever the wifi phase renders its questions (`StepGroup.tsx` or `UnitSurvey.tsx`, whichever renders phase `'7'`) to mount `<WifiSpeedTest>` near `fv_wifi_download_speed_mbps`/`fv_wifi_upload_speed_mbps`

### Task C1: Download-test API route

**Step 1: Write the failing test**

```ts
// src/app/api/first-visit/speedtest/download/__tests__/route.test.ts
import { describe, it, expect } from 'vitest';
import { GET } from '../route';

describe('speedtest download route', () => {
  it('streams the requested number of bytes', async () => {
    const req = new Request('http://localhost/api/first-visit/speedtest/download?bytes=1024');
    const res = await GET(req);
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBe(1024);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('caps bytes at a sane maximum to prevent abuse', async () => {
    const req = new Request('http://localhost/api/first-visit/speedtest/download?bytes=999999999999');
    const res = await GET(req);
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeLessThanOrEqual(50 * 1024 * 1024); // 50MB ceiling
  });
});
```

**Step 2: Run it to verify it fails**
```bash
npx vitest run src/app/api/first-visit/speedtest/download
```
Expected: FAIL — route doesn't exist.

**Step 3: Implement the route**

```ts
// src/app/api/first-visit/speedtest/download/route.ts
const MAX_BYTES = 50 * 1024 * 1024; // 50MB ceiling — plenty for a fast connection, prevents abuse
const DEFAULT_BYTES = 4 * 1024 * 1024; // 4MB default chunk

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = Number(url.searchParams.get('bytes') ?? DEFAULT_BYTES);
  const bytes = Math.min(Math.max(Number.isFinite(requested) ? requested : DEFAULT_BYTES, 0), MAX_BYTES);

  const chunk = new Uint8Array(64 * 1024); // 64KB chunks
  crypto.getRandomValues(chunk); // avoid gzip/compression shrinking the payload in transit

  const stream = new ReadableStream({
    start(controller) {
      let sent = 0;
      while (sent < bytes) {
        const remaining = bytes - sent;
        controller.enqueue(remaining >= chunk.length ? chunk : chunk.slice(0, remaining));
        sent += chunk.length;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes),
      'cache-control': 'no-store',
    },
  });
}
```

**Step 4: Run the test again to verify it passes**
```bash
npx vitest run src/app/api/first-visit/speedtest/download
```
Expected: PASS.

**Step 5: Commit**
```bash
git add src/app/api/first-visit/speedtest/download
git commit -m "feat(fv): add wifi speed-test download endpoint"
```

---

### Task C2: Upload-test API route

**Step 1: Write the failing test**

```ts
// src/app/api/first-visit/speedtest/upload/__tests__/route.test.ts
import { describe, it, expect } from 'vitest';
import { POST } from '../route';

describe('speedtest upload route', () => {
  it('accepts a POST body and returns the byte count received', async () => {
    const body = new Uint8Array(2048);
    const req = new Request('http://localhost/api/first-visit/speedtest/upload', {
      method: 'POST',
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bytesReceived).toBe(2048);
  });
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**

```ts
// src/app/api/first-visit/speedtest/upload/route.ts
export async function POST(req: Request) {
  const buf = await req.arrayBuffer();
  return Response.json({ bytesReceived: buf.byteLength }, { headers: { 'cache-control': 'no-store' } });
}
```

**Step 4: Run the test again to verify it passes.**

**Step 5: Commit**
```bash
git add src/app/api/first-visit/speedtest/upload
git commit -m "feat(fv): add wifi speed-test upload endpoint"
```

---

### Task C3: Ping endpoint

**Step 1: Write the failing test**
```ts
// src/app/api/first-visit/speedtest/ping/__tests__/route.test.ts
import { describe, it, expect } from 'vitest';
import { GET } from '../route';

describe('speedtest ping route', () => {
  it('returns 204 immediately with no-store', async () => {
    const res = await GET();
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**
```ts
// src/app/api/first-visit/speedtest/ping/route.ts
export async function GET() {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
```

**Step 4: Run the test again to verify it passes.**

**Step 5: Commit**
```bash
git add src/app/api/first-visit/speedtest/ping
git commit -m "feat(fv): add wifi speed-test ping endpoint"
```

---

### Task C4: Vendor LibreSpeed client and build the UI component

This task is less TDD-friendly (integrating a third-party JS worker library) — verify behavior manually in the browser rather than with unit tests, since the actual measurement depends on real network conditions.

**Step 1: Vendor the client.** Download LibreSpeed's `speedtest.js` + `speedtest_worker.js` (check their releases page for the current stable version) into `public/vendor/librespeed/`. Do NOT use their hosted CDN version — self-host so it works offline-first/PWA-consistent with the rest of this app.

**Step 2: Confirm the license file is included** alongside the vendored files (e.g. `public/vendor/librespeed/LICENSE`) per the prerequisite check above.

**Step 3: Build `WifiSpeedTest.tsx`**

```tsx
'use client';
import { useRef, useState } from 'react';

type SpeedTestResult = { downloadMbps: number; uploadMbps: number };

export function WifiSpeedTest({
  onResult,
}: {
  onResult: (result: SpeedTestResult) => void;
}) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<{ dl: number; ul: number }>({ dl: 0, ul: 0 });
  const testRef = useRef<InstanceType<typeof window.Speedtest> | null>(null);

  const run = () => {
    setStatus('running');
    setProgress({ dl: 0, ul: 0 });
    const test = new window.Speedtest();
    test.setParameter('telemetry_level', 'none');
    test.addTestPoint({
      name: 'self',
      server: '',
      dlURL: '/api/first-visit/speedtest/download',
      ulURL: '/api/first-visit/speedtest/upload',
      pingURL: '/api/first-visit/speedtest/ping',
      getIpURL: '/api/first-visit/speedtest/ping',
    });
    test.onupdate = (data: { testState: number; dlProgress: number; ulProgress: number; dlStatus: string; ulStatus: string }) => {
      setProgress({ dl: data.dlProgress, ul: data.ulProgress });
    };
    test.onend = (aborted: boolean) => {
      if (aborted) {
        setStatus('error');
        return;
      }
      const dl = Number(test.getState().dlStatus);
      const ul = Number(test.getState().ulStatus);
      if (Number.isFinite(dl) && Number.isFinite(ul)) {
        onResult({ downloadMbps: dl, uploadMbps: ul });
        setStatus('done');
      } else {
        setStatus('error');
      }
    };
    testRef.current = test;
    test.start();
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-gray-200 bg-gray-50 p-3">
      <button
        type="button"
        onClick={run}
        disabled={status === 'running'}
        className="self-start rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {status === 'running' ? 'Running speed test…' : status === 'done' ? 'Run again' : 'Run speed test'}
      </button>
      {status === 'running' && (
        <p className="text-xs text-gray-500">
          Download {Math.round(progress.dl * 100)}% · Upload {Math.round(progress.ul * 100)}%
        </p>
      )}
      {status === 'error' && (
        <p className="text-xs text-red-600">Speed test failed — check your connection and try again.</p>
      )}
    </div>
  );
}
```

Load the vendored script via a `<script>` tag (e.g. in the wifi phase's rendering component, or globally via `next/script` with `strategy="lazyOnload"`) so `window.Speedtest` is defined before `run()` is called — add a loading guard (disable the button until `window.Speedtest` exists).

**Step 4: Wire it into the wifi phase.** Find where phase `'7'` (WiFi, now unit-scoped per Task A1) renders its questions, and mount `<WifiSpeedTest>` near `fv_wifi_download_speed_mbps`, with `onResult` calling the same `onChange` handler used for those two fields to auto-fill them:

```tsx
<WifiSpeedTest
  onResult={({ downloadMbps, uploadMbps }) => {
    onChange(downloadQuestion, { value: Math.round(downloadMbps), wasAcceptedAsIs: false });
    onChange(uploadQuestion, { value: Math.round(uploadMbps), wasAcceptedAsIs: false });
  }}
/>
```
Manual entry stays available — this just pre-fills the same fields, same as any other write path.

**Step 5: Manual verification.** Run `npm run dev`, open the WiFi phase for a unit, tap "Run speed test" on a real network connection, confirm: the two number fields populate with plausible values after the test completes, the progress indicator updates during the test, and a network interruption mid-test shows the error state rather than hanging.

**Step 6: Commit**
```bash
git add public/vendor/librespeed src/components/firstVisit/WifiSpeedTest.tsx
git commit -m "feat(fv): add in-app wifi speed test using LibreSpeed"
```

---

## Chunk D: Check-in step lock gating + photo + scope split

### Task D1: Gate lock sub-fields by lock type

**Files:**
- Modify: `scripts/redesign/rows.mjs` (phase `'4'`, lines 91-104)

**Step 1: Add `visible_when` to the 7 lock-detail fields**

```js
    { slug: 'fv_step_access_point', label: 'Access point', type: 'select',
      options: ['Main Gate', 'Building Door', 'Other'], required: true, group_id: 'checkin_step' },
    { slug: 'fv_step_lock_type', label: 'Lock type', type: 'select',
      options: ['Smart Lock', 'Keypad', 'Ring To Open', 'Call To Open', 'Chip', 'Physical Key'], required: true, group_id: 'checkin_step' },
    { slug: 'fv_step_smart_lock_provider', label: 'Smart lock provider', type: 'select',
      options: ['Nuki', 'Akiles', 'Bold', 'RemoteLock', 'Salto', 'EVVA', 'Other'], required: false, group_id: 'checkin_step',
      visible_when: { question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'fv_step_smart_lock_device_id', label: 'Smart lock device ID / serial', type: 'text', required: false, group_id: 'checkin_step',
      visible_when: { question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'fv_step_lock_brand', label: 'Lock brand / manufacturer', type: 'text', required: false, group_id: 'checkin_step',
      visible_when: { question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'fv_step_lock_classification', label: 'Lock classification', type: 'select',
      options: ['Primary', 'Backup'], required: true, group_id: 'checkin_step',
      visible_when: { question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'fv_step_key_storage_method', label: 'Key storage method', type: 'select',
      options: ['Keybox', 'Locker', 'Human handover'], required: false, group_id: 'checkin_step',
      visible_when: { question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'fv_step_storage_brand', label: 'Storage brand', type: 'text', required: false, group_id: 'checkin_step',
      visible_when: { question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'fv_step_default_access_code', label: 'Default access code', type: 'text', required: false, group_id: 'checkin_step',
      visible_when: { question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
```
Note: `fv_step_access_point`'s options also drop `'Apartment Door'` here (moves to the new unit-level group in Task D3) — `fv_step_lock_classification` keeps `required: true` since it's now conditionally rendered; the app's existing hidden-required exclusion (per `UnitSurvey.tsx` architecture notes) means it won't block progress when hidden.

**Step 2: Add the required photo field** to the same group (append after `fv_step_default_access_code`, before `fv_video_checkin_walkthrough`):
```js
    { slug: 'fv_step_photo', label: 'Photo of this check-in step', type: 'file', mode: 'observe', required: true, group_id: 'checkin_step' },
```

**Step 3: Regenerate and verify** (chunk-A commands)

**Step 4: Write a gating behavior test.** Check whether a general `visible_when` behavior test already exists (`grep -rl "visible_when" src/lib/firstVisit/__tests__/` or `src/components/firstVisit/__tests__/`) — if `isVisible()` (the gating function referenced in project architecture notes) has its own unit test file, add a case there rather than creating a new one:

```ts
it('hides lock detail fields when access has no lock (Ring To Open)', () => {
  const answers = { fv_step_lock_type: 'Ring To Open' };
  expect(isVisible({ question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] }, answers)).toBe(false);
});

it('shows lock detail fields when access uses a real lock (Smart Lock)', () => {
  const answers = { fv_step_lock_type: 'Smart Lock' };
  expect(isVisible({ question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] }, answers)).toBe(true);
});
```
Run: `npx vitest run <that test file>` — expect PASS (this exercises the existing `not_in` gate type, already used elsewhere in the codebase, so no new gating logic is needed — this test only confirms the new rule composes correctly).

**Step 5: Commit**
```bash
git add scripts/redesign/rows.mjs src/data/first-visit-content.json src/lib/firstVisit/questionStructure.ts
git commit -m "feat(fv): gate check-in lock fields by lock type, add required step photo"
```

---

### Task D2: Add unit-level "Apartment Door" check-in group

**Files:**
- Modify: `scripts/redesign/rows.mjs` (new phase inserted between `'9'` Unit capacity and `'11'` — note: after Task A7, phase `'10'` no longer exists at this position, so this new phase slots in right after `'9'`)
- Modify: `src/data/section-voice-prompts.ts` (new phase entry, mirroring phase `'4'`'s `p4_checkin_step`)

**Step 1: Add the new phase to `rows.mjs`**, positioned right after phase `'9'` (Unit capacity):

```js
  // ── 18 · Unit check-in — apartment door (unit_category) ──────────────────
  // Per-unit twin of phase 4's building-level check-in steps: building-wide
  // entry points (Main Gate, Building Door) stay a one-time building
  // walkthrough; the apartment door itself varies per unit, so it gets its
  // own per-unit repeater here (copy-from-unit covers units that match).
  { id: '18', label: 'Unit check-in — apartment door', scope: 'unit_category', questions: [
    { slug: 'unit_step_name', label: 'Check-in step name', type: 'text', required: true, group_id: 'unit_checkin_step',
      description: 'Free-text per step; repeatable — all per-step fields below repeat for each step.' },
    { slug: 'unit_step_lock_type', label: 'Lock type', type: 'select',
      options: ['Smart Lock', 'Keypad', 'Ring To Open', 'Call To Open', 'Chip', 'Physical Key'], required: true, group_id: 'unit_checkin_step' },
    { slug: 'unit_step_smart_lock_provider', label: 'Smart lock provider', type: 'select',
      options: ['Nuki', 'Akiles', 'Bold', 'RemoteLock', 'Salto', 'EVVA', 'Other'], required: false, group_id: 'unit_checkin_step',
      visible_when: { question: 'unit_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'unit_step_smart_lock_device_id', label: 'Smart lock device ID / serial', type: 'text', required: false, group_id: 'unit_checkin_step',
      visible_when: { question: 'unit_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'unit_step_lock_brand', label: 'Lock brand / manufacturer', type: 'text', required: false, group_id: 'unit_checkin_step',
      visible_when: { question: 'unit_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'unit_step_lock_classification', label: 'Lock classification', type: 'select',
      options: ['Primary', 'Backup'], required: true, group_id: 'unit_checkin_step',
      visible_when: { question: 'unit_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'unit_step_key_storage_method', label: 'Key storage method', type: 'select',
      options: ['Keybox', 'Locker', 'Human handover'], required: false, group_id: 'unit_checkin_step',
      visible_when: { question: 'unit_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'unit_step_storage_brand', label: 'Storage brand', type: 'text', required: false, group_id: 'unit_checkin_step',
      visible_when: { question: 'unit_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'unit_step_default_access_code', label: 'Default access code', type: 'text', required: false, group_id: 'unit_checkin_step',
      visible_when: { question: 'unit_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] } },
    { slug: 'unit_step_photo', label: 'Photo of this check-in step', type: 'file', mode: 'observe', required: true, group_id: 'unit_checkin_step' },
  ]},
```

**Step 2: Add a `repeaterGroups.ts` display entry** for `unit_checkin_step`, mirroring the existing `checkin_step` entry:
```bash
grep -n "checkin_step" src/lib/firstVisit/repeaterGroups.ts
```
Add a matching entry with an appropriate title (e.g. "Apartment door check-in").

**Step 3: Add a section-voice-fill prompt** for phase `'18'` in `section-voice-prompts.ts`, mirroring `p4_checkin_step` (line ~98):
```ts
  // 18 · Unit check-in — apartment door
  '18': [
    {
      id: 'p18_checkin_step',
      label:
        'Walk through the apartment door check-in — the step name, the lock type and provider, the lock brand, whether it is primary or backup, and how keys are stored.',
      target_slugs: [
        'unit_step_name',
        'unit_step_lock_type',
        'unit_step_smart_lock_provider',
        'unit_step_lock_brand',
        'unit_step_lock_classification',
        'unit_step_key_storage_method',
        'unit_step_storage_brand',
      ],
    },
  ],
```

**Step 4: Regenerate and verify** (chunk-A commands)

**Step 5: Commit**
```bash
git add scripts/redesign/rows.mjs src/data/section-voice-prompts.ts src/lib/firstVisit/repeaterGroups.ts src/data/first-visit-content.json src/lib/firstVisit/questionStructure.ts src/lib/firstVisit/__tests__/__fixtures__/all-questions.snapshot.json
git commit -m "feat(fv): add per-unit apartment door check-in group, split from building-level check-in"
```

**Step 6: Manual verification.** Run `npm run dev`, open a unit's survey, confirm the new "Unit check-in — apartment door" phase appears, the lock fields hide/show correctly based on lock type, and "copy from another unit" carries the new fields across units as expected (it should, automatically, per the existing generic copy behavior).

---

## Chunk E: Export ZIP fix

### Task E1: Drop manifest.json, add human-readable question text to answers.csv

**Files:**
- Modify: `src/lib/firstVisit/export.ts`
- Modify: `src/lib/firstVisit/__tests__/export.test.ts`

**Step 1: Update the existing test to reflect the new expected format**

```ts
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { localDb } from '../db';
import { exportInspection } from '../export';

describe('exportInspection', () => {
  it('produces a zip with answers.csv (no manifest.json), including human-readable question text', async () => {
    await localDb.inspections.clear();
    await localDb.answers.clear();
    await localDb.media.clear();
    await localDb.inspections.put({
      id: 'i', deal_id: 'd', status: 'draft',
      inspector_email: 'a@arbio.com', started_at: '2026-05-22T00:00:00Z',
    });
    await localDb.answers.put({
      id: 'a', inspection_id: 'i', target_id: 'i', scope: 'deal',
      question_key: 'fv_visit_date', area_key: '1',
      value: '2026-07-08', was_prefilled: false, was_accepted_as_is: false,
      created_at: '', updated_at: '',
    });
    const blob = await exportInspection('i');
    const zip = await JSZip.loadAsync(blob);
    expect(zip.file('manifest.json')).toBeNull();
    expect(zip.file('answers.csv')).not.toBeNull();
    const csv = await zip.file('answers.csv')!.async('string');
    expect(csv).toContain('question_key,question_text,area_key,value');
    expect(csv).toContain('fv_visit_date,');
    // The human-readable label for fv_visit_date should appear somewhere on that row.
    const dataLine = csv.split('\n').find((l) => l.includes('fv_visit_date'));
    expect(dataLine).toBeTruthy();
    // UTF-8 BOM first so Excel on Windows decodes umlauts correctly.
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('renders boolean answers as Yes/No instead of true/false', async () => {
    await localDb.inspections.clear();
    await localDb.answers.clear();
    await localDb.inspections.put({
      id: 'i2', deal_id: 'd', status: 'draft',
      inspector_email: 'a@arbio.com', started_at: '2026-05-22T00:00:00Z',
    });
    await localDb.answers.put({
      id: 'a2', inspection_id: 'i2', target_id: 'i2', scope: 'deal',
      question_key: 'fv_wifi_present', area_key: '7',
      value: true, was_prefilled: false, was_accepted_as_is: false,
      created_at: '', updated_at: '',
    });
    const blob = await exportInspection('i2');
    const zip = await JSZip.loadAsync(blob);
    const csv = await zip.file('answers.csv')!.async('string');
    expect(csv).toContain('Yes');
    expect(csv).not.toMatch(/,true,/);
  });
});
```

**Step 2: Run to verify it fails**
```bash
npx vitest run src/lib/firstVisit/__tests__/export.test.ts
```
Expected: FAIL — `manifest.json` still exists, no `question_text` column, booleans render as `true`/`false`.

**Step 3: Implement the fix**

```ts
import JSZip from 'jszip';
import { localDb } from './db';
import { track } from './analytics';
import { ALL_QUESTIONS } from './questions';

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function displayValue(v: unknown): unknown {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return v;
}

const QUESTION_LABELS = new Map(ALL_QUESTIONS.map((q) => [q.slug, q.label]));

export async function exportInspection(inspectionId: string): Promise<Blob> {
  const zip = new JSZip();

  const answers = await localDb.answers.where('inspection_id').equals(inspectionId).toArray();
  const media = await localDb.media.where('inspection_id').equals(inspectionId).toArray();

  // CSV
  const header = [
    'question_key','question_text','area_key','value','notes',
    'was_prefilled','was_accepted_as_is','hub_suggestion_snapshot','captured_at',
  ].join(',');
  const rows = answers.map((a) => [
    a.question_key,
    QUESTION_LABELS.get(a.question_key) ?? '',
    a.area_key,
    displayValue(a.value),
    a.notes ?? '',
    a.was_prefilled, a.was_accepted_as_is,
    a.hub_suggestion_snapshot ?? '', a.created_at,
  ].map(csvCell).join(','));
  // UTF-8 BOM so Excel on Windows opens the CSV as UTF-8 (umlauts intact).
  zip.file('answers.csv', '﻿' + [header, ...rows].join('\n'));

  // Media
  for (const m of media) {
    const folder = `${m.kind}s`;
    const ext = m.kind === 'photo' ? 'jpg' : m.kind === 'video' ? 'mp4' : 'webm';
    const safeArea = m.area_key.replace(/[^a-z0-9_-]/gi, '_');
    const safeQuestion = (m.question_key ?? 'general').replace(/[^a-z0-9_-]/gi, '_');
    zip.file(`${folder}/${safeArea}_${safeQuestion}_${m.id}.${ext}`, m.blob);
  }

  return zip.generateAsync({ type: 'blob' });
}

export async function downloadInspectionZip(inspectionId: string): Promise<void> {
  const blob = await exportInspection(inspectionId);
  track('export_generated', { inspection_id: inspectionId });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `first-visit-${inspectionId}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
```

Note: `inspection` is no longer fetched since it was only used for `manifest.json` — remove the now-unused `localDb.inspections.get(inspectionId)` call too (was line 15 in the original).

Repeater questions (`issue_name`, `prop_issue_name`, `unit_step_name`, etc.) won't have a clean single label lookup collision risk since slugs are unique across `ALL_QUESTIONS` — confirm this holds (it does, per `gen.mjs`'s duplicate-slug guard at generation time).

**Step 4: Run the test again to verify it passes**
```bash
npx vitest run src/lib/firstVisit/__tests__/export.test.ts
```
Expected: PASS.

**Step 5: Run the full suite** to confirm nothing else depended on `manifest.json` being present:
```bash
npx vitest run --pool=forks
```

**Step 6: Commit**
```bash
git add src/lib/firstVisit/export.ts src/lib/firstVisit/__tests__/export.test.ts
git commit -m "fix(fv): drop manifest.json from export, add human-readable question text and Yes/No values to answers.csv"
```

---

## Post-implementation checklist

- [ ] Full test suite green: `npx vitest run --pool=forks`
- [ ] `npm run build` succeeds (catches TS errors the test suite might not)
- [ ] Manual smoke test in browser for each chunk's UI-visible change (voice button position, media gallery no-duplicate, upload indicator, scope badge, tap targets, speed test, check-in gating, export zip contents)
- [ ] File the hub-registry follow-up ticket for deactivating `fv_apartment_category` (Task A6)
- [ ] Confirm LibreSpeed license check outcome is documented somewhere before merging Chunk C
