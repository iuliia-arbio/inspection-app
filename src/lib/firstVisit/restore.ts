import { localDb, type LocalAnswer, type LocalInspection, type LocalTarget } from './db';
import type { HubScope } from './resolveScope';

type HubInspection = {
  id: string;
  deal_id: string;
  status: 'draft' | 'submitted' | 'discarded';
  inspector_email: string;
  started_at: string;
  submitted_at: string | null;
};

type HubTarget = {
  id: string;
  inspection_id: string;
  kind: 'property' | 'unit';
  parent_id: string | null;
  location_id: string | null;
  unit_category_id: string | null;
  label: string | null;
  created_on_site: boolean | null;
  order: number | null;
};

type HubAnswer = {
  id: string;
  inspection_id: string;
  target_id: string | null;
  scope: HubScope | null;
  location_id: string | null;
  unit_category_id: string | null;
  question_key: string;
  area_key: string;
  step_index: number | null;
  value: unknown;
  notes: string | null;
  data_point_slug: string | null;
  hub_suggestion_snapshot: unknown;
  was_prefilled: boolean | null;
  was_accepted_as_is: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type RestoreResult = {
  inspections: number;
  targets: number;
  answers: number;
};

// Rebuilds this browser's local store from the hub's copy of the caller's
// visits. Sync is one-way (device → hub), so a device that lost its
// IndexedDB — in-app webview eviction, new phone, cleared site data — has no
// other way back. Writes go straight into Dexie, never through enqueue(), so
// a restore can't echo rows back into the outbox. Existing local rows are
// never downgraded: an answer is only overwritten when the hub's copy is
// strictly newer, and inspections/targets are only added, not replaced
// (except a draft→submitted status upgrade). Media blobs are not restored.
export async function restoreFromCloud(): Promise<RestoreResult> {
  const res = await fetch('/api/first-visit/restore');
  if (!res.ok) throw new Error(`restore failed (${res.status})`);
  const payload: { inspections: HubInspection[]; targets: HubTarget[]; answers: HubAnswer[] } =
    await res.json();

  const now = new Date().toISOString();
  const result: RestoreResult = { inspections: 0, targets: 0, answers: 0 };

  for (const i of payload.inspections ?? []) {
    const local = await localDb.inspections.get(i.id);
    if (!local) {
      const row: LocalInspection = {
        id: i.id,
        deal_id: i.deal_id,
        status: i.status,
        inspector_email: i.inspector_email,
        started_at: i.started_at,
        submitted_at: i.submitted_at ?? undefined,
        synced_at: now,
      };
      await localDb.inspections.put(row);
      result.inspections++;
    } else if (local.status === 'draft' && i.status === 'submitted') {
      await localDb.inspections.put({
        ...local,
        status: 'submitted',
        submitted_at: i.submitted_at ?? local.submitted_at,
        synced_at: now,
      });
      result.inspections++;
    }
  }

  for (const t of payload.targets ?? []) {
    const local = await localDb.targets.get(t.id);
    if (local) continue;
    const row: LocalTarget = {
      id: t.id,
      inspection_id: t.inspection_id,
      kind: t.kind,
      parent_id: t.parent_id ?? undefined,
      location_id: t.location_id ?? undefined,
      unit_category_id: t.unit_category_id ?? undefined,
      label: t.label ?? '',
      created_on_site: !!t.created_on_site,
      order: t.order ?? 0,
    };
    await localDb.targets.put(row);
    result.targets++;
  }

  for (const a of payload.answers ?? []) {
    // Deal-scoped answers use the visit root as their target; anything else
    // without a target_id can't be placed in the tree and is left out.
    const target_id = a.target_id ?? (a.scope === 'deal' ? a.inspection_id : null);
    if (!target_id) continue;

    const local = await localDb.answers.get(a.id);
    const hubUpdated = a.updated_at ?? a.created_at ?? '';
    if (local && local.updated_at >= hubUpdated) continue;

    const row: LocalAnswer = {
      id: a.id,
      inspection_id: a.inspection_id,
      target_id,
      scope: a.scope ?? 'deal',
      location_id: a.location_id ?? undefined,
      unit_category_id: a.unit_category_id ?? undefined,
      question_key: a.question_key,
      area_key: a.area_key,
      // The server stores -1 as the "single answer" sentinel; locally that is
      // null/undefined (repeater rows are step_index >= 0).
      step_index: typeof a.step_index === 'number' && a.step_index >= 0 ? a.step_index : null,
      value: a.value,
      notes: a.notes ?? undefined,
      data_point_slug: a.data_point_slug ?? undefined,
      hub_suggestion_snapshot: a.hub_suggestion_snapshot ?? undefined,
      was_prefilled: !!a.was_prefilled,
      was_accepted_as_is: !!a.was_accepted_as_is,
      created_at: a.created_at ?? now,
      updated_at: hubUpdated || now,
      synced_at: now,
    };
    await localDb.answers.put(row);
    result.answers++;
  }

  return result;
}
