# First-Visit survey UX bug triage — design

Date: 2026-07-07
Branch: fix/fv-submit-honesty (or a new branch per implementation plan)

## Context

Joshua walked through the First-Visit survey app and flagged 18 issues/requests. Each was verified against the actual code (not assumed) before proposing a fix — several turned out to not be what they first appeared (e.g. "issue block has no voice-to-text" was actually "building issues has no *section* voice-fill"; "wifi issue filling" was dropped as not reproducible; "parking AI description" revealed there's no real AI-fill wired up at all).

This doc records the agreed fix for each item, to hand off to implementation planning.

## 1. Wifi → unit level

Move all 7 `fv_wifi_*` questions from `scope: 'location'` to `scope: 'unit_category'` in `scripts/redesign/rows.mjs`, fully replacing the building-level wifi section (not keeping both). Regenerate `questionStructure.ts` / `first-visit-content.json`.

Rationale: several units can share one network (copy-from-unit handles that case for free once wifi is unit-scoped) but some units have their own network (this requires per-unit fields to exist at all).

Verify the PMS mapping in `questionStructure.ts` (currently maps `fv_wifi_download_speed_mbps`/`upload_speed_mbps` to `profile.wifiDetails.*`) still resolves correctly once scope changes.

No changes needed to "copy from other unit" (`CopyFromUnitPicker.tsx` / `UnitSurvey.tsx:213-239`) — it already copies all unit-scoped answers generically.

## 2. Wifi speed test

Integrate LibreSpeed (github.com/librespeed/speedtest) client-side JS against self-hosted backend endpoints (do not use their public demo servers). Needs:
- A streaming download-test API route (serves junk data, aborts on client disconnect).
- An upload-test API route (accepts and discards POSTed data, timing it server-side).
- A ping/jitter endpoint.
- Wire LibreSpeed's client into a new "Run speed test" UI control that, on completion, writes the measured download/upload Mbps into the existing `fv_wifi_download_speed_mbps` / `fv_wifi_upload_speed_mbps` fields (manual entry stays available as a fallback/override).

**Action item before implementation:** verify LibreSpeed's license terms (GPL-family) are compatible with vendoring its client code into this repo.

## 3. Building issues missing section voice-fill

Add a new entry to `SECTION_VOICE_PROMPTS` in `src/data/section-voice-prompts.ts` for phase `'16'` (Building condition & issues), mirroring the existing `p10_issues` entry but targeting `prop_issue_name`, `prop_issue_type`, `prop_issue_area`, `prop_issue_resolution`, `prop_issue_quantity`, `prop_issue_cost_estimate_eur`, `prop_issue_urgency`, `prop_issue_notes`.

## 4. Check-in steps: gate lock fields + add photo + split by scope

Three changes to the check-in step group in `rows.mjs`:

a) **Gate lock sub-fields.** Add `visible_when: { question: 'fv_step_lock_type', not_in: ['Ring To Open', 'Call To Open'] }` to: `fv_step_smart_lock_provider`, `fv_step_smart_lock_device_id`, `fv_step_lock_brand`, `fv_step_lock_classification`, `fv_step_key_storage_method`, `fv_step_storage_brand`, `fv_step_default_access_code`. Always-visible fields stay: `fv_step_name`, `fv_step_access_point`, `fv_step_lock_type`.

b) **Add a required photo field** (`type: 'file'`) to the check-in step group, applying to every step regardless of lock presence.

c) **Split by scope.** Remove `'Apartment Door'` from `fv_step_access_point`'s options (leaving `['Main Gate', 'Building Door', 'Other']`) for the building-level group (stays `scope: 'location'`, phase 4). Create a new unit-level check-in group (new phase, `scope: 'unit_category'`, positioned early in the unit block near phase 8 "Unit identity") carrying the Apartment Door check-in step with the same field set (name, access point fixed to "Apartment Door" or removed as a choice, lock type + gated lock fields + photo).

Existing `visible_when` gating and the answer-clearing-on-hide behavior in `UnitSurvey.tsx` apply automatically to the new gate — no changes needed there.

## 5. Auto-show existing deal's property

In `VisitNavigator.tsx`, after the snapshot loads (~line 157-163), iterate `snapshot.locations` and call the existing `addPropertyFromHub(loc)` (currently only called from the manual "Add property" picker, lines 283-296) for every location not already represented by a local `LocalTarget`. Do this for **all** hub locations on the deal, not just when there's exactly one.

Keep the manual "Add property" control for properties not yet in the hub.

## 6. Move voice-to-text button inside the text box

In `PrefilledField.tsx` (~line 296-314, 485-517), restructure the text-field wrapper so:
- The input/textarea reserves right-side padding.
- The mic button (`VoiceDictationButton`) is absolutely positioned inside the box, right side — vertically centered for single-line inputs, pinned top-right for `AutoGrowTextarea` so it doesn't overlap wrapped text.

Applies globally since it's the shared field component.

## 7. Fix duplicate media display + add upload indicator

a) **Duplicate fix.** In `StepGroup.tsx` (~line 400), don't render `AttachAffordance`'s photo/video buttons or its `MediaGallery` when the sibling question is `type: 'file'` (it already has `MediaButtons` with its own gallery). Keep `AttachAffordance`'s note capability available — add a prop (e.g. `hideMedia`) to `AttachAffordance` that suppresses only the photo/video/gallery parts, not the note toggle/textarea.

b) **Upload indicator.** In `MediaGallery.tsx`, add a small visual state per thumbnail based on the existing (currently unused) `LocalMedia.uploaded_at` field: "uploading…" before it's set, a checkmark badge once it is.

## 8. Remove misleading parking AI description

In `rows.mjs`, remove or reword the `fv_parking_nearby_options` description (currently `"AI-generated from the address; PM validates/regenerates."`) since no such automation exists in this codebase. Building a real automatic AI/Places lookup is a separate, larger cross-system project (would likely involve the Onboarding Hub, not this app) — explicitly out of scope here.

## 9. Building amenities: translate + fix "None" exclusivity

a) Translate `fv_building_amenities_verify` options in `rows.mjs` from German to English: `Aufzug→Elevator`, `Gemeinschafts Balkon/Terrasse→Shared balcony/terrace`, `Gemeinschaftsgarten→Shared garden`, `Schwimmbad→Pool`, `Sauna→Sauna`, `Fitnessraum→Gym`, `Konferenzräume→Conference rooms`, `Reception/Concierge` unchanged, `None` unchanged.

b) Add a generic "None is exclusive" rule to the multi-select rendering logic (shared component, likely in `PrefilledField.tsx`'s multi-select branch): selecting an option literally named `"None"` deselects all other selected options in that field, and selecting any other option deselects `"None"`. Applies automatically to every multi-select with a `"None"` option (`fv_building_amenities_verify`, `fv_common_area`, the guest-amenities field), not just this one.

## 10. Reposition scope badge

In `UnitSurvey.tsx` (~line 648-656), move the gray scope badge (`scopeLabel(scope)`) from inline beside the section heading to its own line below the heading.

## 11. Move "Common areas" question out of fire-safety block

In `rows.mjs`, move `fv_common_area` from Phase 5 ("Building infrastructure & services," currently the last item after the fire-safety questions) to Phase 3 ("Building exterior & parking"), positioned immediately after `fv_building_amenities_verify`. Picks up the "None" exclusivity fix from item 9 automatically.

## 12. Fix voice-to-text auto-stop on field mic

In `useVoiceDictation.ts` (~line 65), pass an `onSilence` callback to `start()` — the same silence-detection mechanism (`SPEECH_RMS`/`SILENCE_MS` in `useVoiceRecorder.ts`) already used by `useSectionVoiceFill.ts`. No new detection logic; just enable the existing one for the per-field mic.

## 13. Remove apartment category question

Remove `fv_apartment_category` from `rows.mjs` entirely (no `visible_when` rules reference it, so no gating side effects). Separately (outside this app's codebase), deactivate the corresponding hub data-point registry entry — a deliberate registry change made in the Hub app itself, tracked as a follow-up, not part of this app's PR.

## 14. Split & reorder unit condition/issues

In `rows.mjs`:
a) Move `fv_furniture_status`, `fv_equipment_status`, `fv_bathroom_condition` from Phase 10 to the start of Phase 11 ("Unit appliances & amenities"), renaming Phase 11 to "Unit condition, appliances & amenities."
b) Move the issue log (`fv_issues_found` + all `issue_*` fields, currently the rest of Phase 10) into a new phase positioned immediately after "Unit photos & videos" (14) and before "Final assessment / readiness" (15) — mirroring where the building issue log sits relative to the building block (last thing before moving on).
c) Delete the now-empty Phase 10.

Field parity between unit and building issue logs is already close (same shape, same gating pattern) — no field changes needed here, purely reordering.

## 15. Bigger tap targets for icon buttons

In `VisitNavigator.tsx`, apply `40×40px` (or `44×44px`) sizing — matching the existing convention used elsewhere in the app (`h-10 w-10` keypad buttons in `InspectionFlowClient.tsx`, `min-h-[44px]` in `DealSelectionClient.tsx`) — to: delete property (🗑, line ~583-591), rename unit (✎, ~829-837), delete unit (🗑, ~838-846), add-property trigger (~869-874), add-unit trigger (~949-953).

## 16. Human-readable export CSV + drop manifest

In `export.ts`:
a) Remove the `manifest.json` file from the zip (line 33).
b) Add a `question_text` column to `answers.csv`, looked up from the same content source (`first-visit-content.json`) that renders question labels in the survey — so the exported text matches exactly what the inspector saw on screen.
c) Decode boolean answer values (`true`/`false`) to `Yes`/`No` in the CSV to match survey display.

## Sequencing note

Nothing here is architecturally risky, but several items touch the same generated files (`rows.mjs` → regenerate `questionStructure.ts`/`first-visit-content.json`/PMS snapshot), so content-only changes (items 1, 3, 4c partially, 8, 9a, 11, 13, 14) should land together to minimize regeneration churn, separate from UI-only changes (6, 7, 10, 12, 15) and the export fix (16). The wifi speed test (2) and check-in split (4) are the two biggest, most self-contained pieces and can each be their own PR.
