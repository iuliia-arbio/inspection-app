// Batch writer for AI-extracted section-voice suggestions.
//
// AI values ride the SAME "suggestion → confirm" channel as hub prefills: each
// field is written with value:null + was_prefilled:true and the proposed value
// in hub_suggestion_snapshot ({ __ai:true, value, confidence }). That makes it
// render as the existing yellow "Pre-filled / Accept" banner with no new review
// UI. We write rows directly (not via UnitSurvey.onChange) because onChange
// preserves the existing row's prefilled flags and so can't STAMP a fresh row as
// a suggestion.
import { localDb, type LocalAnswer } from './db';
import { enqueue } from './sync';
import type { HubScope } from './resolveScope';
import type { AiField, ValidatedExtraction } from './validateExtraction';

export const LOW_CONF_THRESHOLD = 0.6;

// Marker wrapper stored in hub_suggestion_snapshot so the read path can tell an
// AI suggestion from a legacy hub snapshot (a raw scalar).
export type AiSnapshot = { __ai: true; value: unknown; confidence: number | null };

export function isAiSnapshot(snap: unknown): snap is AiSnapshot {
  return !!snap && typeof snap === 'object' && (snap as { __ai?: unknown }).__ai === true;
}

// Unwrap a suggestion snapshot to the value the Accept banner should show.
// Legacy hub snapshots are raw scalars; AI snapshots wrap { value }.
export function unwrapAiSnapshot(snap: unknown): unknown {
  return isAiSnapshot(snap) ? snap.value : snap;
}

export function snapshotConfidence(snap: unknown): number | null {
  return isAiSnapshot(snap) ? snap.confidence : null;
}

const repeaterKey = (t: string, a: string, qk: string, step: number) => `${t}::${a}::${qk}::${step}`;
const singleKey = (t: string, a: string, qk: string) => `${t}::${a}::${qk}`;

// Highest occupied step_index for a repeater group at this target+area, or -1 if
// none. Soft-deleted blocks still occupy their index, so we count every row that
// carries one of the group's slugs (avoids index collisions on append).
export function maxStepIndexForGroup(
  answers: Record<string, LocalAnswer>,
  groupSlugs: string[],
  targetId: string,
  areaKey: string,
): number {
  const slugs = new Set(groupSlugs);
  let max = -1;
  for (const row of Object.values(answers)) {
    if (
      row.target_id === targetId &&
      row.area_key === areaKey &&
      typeof row.step_index === 'number' &&
      slugs.has(row.question_key)
    ) {
      if (row.step_index > max) max = row.step_index;
    }
  }
  return max;
}

type WriteArgs = {
  inspectionId: string;
  targetId: string;
  /** The prompt's phase_id — used as area_key (avoids finding_* scope-dupe ambiguity). */
  areaKey: string;
  scope: HubScope;
  ctx: { location_id?: string; unit_category_id?: string };
  extraction: ValidatedExtraction;
  /** Current answers (keyed `${t}::${a}::${qk}` or `…::${step}`) for step alloc + don't-clobber. */
  answers: Record<string, LocalAnswer>;
  /** group_id → ordered field slugs (from buildExtractionSchema). */
  groupSlugsByGroup: Record<string, string[]>;
  /** Synthetic slug the prompt's qualitative summary is stored under. When set
   *  and the extraction carries a summary, a single editable text row is written
   *  (question_key = this, value = the summary prose). Omit to skip. */
  summarySlug?: string;
  /** When false, the structured singles/items are NOT written — only the summary
   *  (for `qualitative_only` prompts). Defaults to true. */
  writeStructured?: boolean;
};

export type AiFillResult = {
  writtenRows: LocalAnswer[];
  singlesWritten: number;
  itemsWritten: number;
};

function buildRow(args: {
  inspectionId: string;
  targetId: string;
  areaKey: string;
  scope: HubScope;
  ctx: { location_id?: string; unit_category_id?: string };
  slug: string;
  field: AiField;
  stepIndex: number | null;
  existing?: LocalAnswer;
  now: string;
}): LocalAnswer {
  const { inspectionId, targetId, areaKey, scope, ctx, slug, field, stepIndex, existing, now } = args;
  return {
    id: existing?.id ?? crypto.randomUUID(),
    inspection_id: inspectionId,
    target_id: targetId,
    scope,
    location_id: ctx.location_id,
    unit_category_id: ctx.unit_category_id,
    question_key: slug,
    area_key: areaKey,
    step_index: stepIndex,
    value: null, // suggestion is unconfirmed until the inspector Accepts/edits
    notes: existing?.notes, // this literal replaces the whole row — keep a note-only stub's note
    data_point_slug: slug,
    hub_suggestion_snapshot: { __ai: true, value: field.value, confidence: field.confidence } as AiSnapshot,
    was_prefilled: true,
    was_accepted_as_is: false,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}

// Write the validated extraction as suggestion rows. Singles go to step_index
// null (skipping any field the inspector has already answered); each repeater
// item is appended at a fresh step_index. Persists to Dexie + enqueues sync,
// exactly like onChange.
export async function writeAiSuggestions(args: WriteArgs): Promise<AiFillResult> {
  const { inspectionId, targetId, areaKey, scope, ctx, extraction, answers, groupSlugsByGroup } = args;
  const writeStructured = args.writeStructured ?? true;
  const now = new Date().toISOString();
  const rows: LocalAnswer[] = [];
  let singlesWritten = 0;
  let itemsWritten = 0;

  if (writeStructured) {
    // Singles — skip fields with no value, and don't clobber an already-answered field.
    for (const [slug, field] of Object.entries(extraction.singles)) {
      if (field.value == null) continue;
      const existing = answers[singleKey(targetId, areaKey, slug)];
      if (existing && (existing.value != null || existing.was_accepted_as_is)) continue;
      rows.push(buildRow({ inspectionId, targetId, areaKey, scope, ctx, slug, field, stepIndex: null, existing, now }));
      singlesWritten++;
    }

    // Repeater items — append each at a fresh step_index, per group.
    const nextIndexByGroup: Record<string, number> = {};
    for (const item of extraction.items) {
      const groupSlugs = groupSlugsByGroup[item.group_id];
      if (!groupSlugs) continue;
      if (nextIndexByGroup[item.group_id] === undefined) {
        nextIndexByGroup[item.group_id] = maxStepIndexForGroup(answers, groupSlugs, targetId, areaKey) + 1;
      }
      const step = nextIndexByGroup[item.group_id]++;
      let wroteField = false;
      for (const [slug, field] of Object.entries(item.fields)) {
        if (field.value == null) continue;
        const existing = answers[repeaterKey(targetId, areaKey, slug, step)];
        rows.push(buildRow({ inspectionId, targetId, areaKey, scope, ctx, slug, field, stepIndex: step, existing, now }));
        wroteField = true;
      }
      if (wroteField) itemsWritten++;
    }
  }

  // Qualitative summary — a single editable text row written DIRECTLY to value
  // (not the Accept-to-confirm channel; it's prose the inspector reviews/edits).
  // Re-recording overwrites it (intentional redo), reusing the existing row id.
  if (args.summarySlug && typeof extraction.summary === 'string' && extraction.summary) {
    const existing = answers[singleKey(targetId, areaKey, args.summarySlug)];
    rows.push({
      id: existing?.id ?? crypto.randomUUID(),
      inspection_id: inspectionId,
      target_id: targetId,
      scope,
      location_id: ctx.location_id,
      unit_category_id: ctx.unit_category_id,
      question_key: args.summarySlug,
      area_key: areaKey,
      step_index: null,
      value: extraction.summary,
      notes: existing?.notes, // re-record replaces the row — keep an attached note
      data_point_slug: args.summarySlug,
      was_prefilled: true,
      was_accepted_as_is: false,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
  }

  if (rows.length) {
    await localDb.answers.bulkPut(rows);
    for (const row of rows) await enqueue('answer_upsert', row);
  }

  return { writtenRows: rows, singlesWritten, itemsWritten };
}

// Accept a batch of AI suggestion rows in one go ("Accept all from this prompt"):
// copy each row's snapshot value into `value` and mark was_accepted_as_is, exactly
// as the per-field Accept button does. Only touches still-unconfirmed AI rows.
// The rows passed in are snapshots captured at suggestion-write time, so each is
// re-read from Dexie by id and the decision/spread made on the FRESH row — a
// value the inspector typed (or notes added) after the voice fill must win over
// the stale snapshot, and rows deleted since are skipped.
// Returns the updated rows so the survey can merge them into state.
export async function acceptAiRows(rows: LocalAnswer[]): Promise<LocalAnswer[]> {
  const now = new Date().toISOString();
  const updated: LocalAnswer[] = [];
  const fresh = await localDb.answers.bulkGet(rows.map((r) => r.id));
  for (const row of fresh) {
    if (!row) continue; // deleted since the suggestion was written
    if (!isAiSnapshot(row.hub_suggestion_snapshot)) continue;
    if (row.value != null || row.was_accepted_as_is) continue; // already confirmed/edited
    const value = unwrapAiSnapshot(row.hub_suggestion_snapshot);
    if (value == null || value === '') continue;
    updated.push({ ...row, value, was_accepted_as_is: true, updated_at: now });
  }
  if (updated.length) {
    await localDb.answers.bulkPut(updated);
    for (const row of updated) await enqueue('answer_upsert', row);
  }
  return updated;
}
