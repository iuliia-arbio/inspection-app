import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';
import { buildFindingsCsv, type FindingRow } from '@/lib/firstVisit/findingsCsv';

// Buckets keyed by media kind — mirrors src/app/api/first-visit/media/route.ts.
const BUCKETS: Record<string, string> = {
  photo: 'first-visit-photos',
  video: 'first-visit-videos',
  audio: 'first-visit-audio',
};

// The Issue-log field slugs (V1 redesign — formerly finding_*), stored on
// first_visit_answers with question_key = '<slug>' and a separate step_index.
// The CSV merges TWO issue logs into one sheet: the unit-level log (issue_*,
// phase 10) and the property/building-level log (prop_issue_*, phase 16). The
// building log mirrors the unit log field-for-field, so we map its slugs back
// to the canonical issue_* keys the row builder reads — prop_issue_area is the
// building counterpart of issue_location ("Location in unit"). Building issues
// carry scope 'location', which the row builder already labels "Building /
// common" via the unit_identifier branch below.
const PROP_FIELD_TO_CANONICAL: Record<string, string> = {
  prop_issue_name: 'issue_name',
  prop_issue_type: 'issue_type',
  prop_issue_area: 'issue_location',
  prop_issue_resolution: 'issue_resolution',
  prop_issue_quantity: 'issue_quantity',
  prop_issue_cost_estimate_eur: 'issue_cost_estimate_eur',
  prop_issue_urgency: 'issue_urgency',
  prop_issue_notes: 'issue_notes',
};

const FINDING_FIELD_SLUGS = [
  'issue_name',
  'issue_type',
  'issue_location',
  'issue_resolution',
  'issue_quantity',
  'issue_cost_estimate_eur',
  'issue_urgency',
  'issue_notes',
  ...Object.keys(PROP_FIELD_TO_CANONICAL),
] as const;

// Issue media is stored with question_key = `issue_media::<stepIndex>` (unit
// log) or `prop_issue_media::<stepIndex>` (building log) — see StepGroup.tsx.
// Pull the step index back out so we can pair media with the issue fields that
// share the same (target_id, step_index).
export function parseFindingMediaStep(questionKey: string): number | null {
  const m = /^(?:prop_)?issue_media::(\d+)$/.exec(questionKey);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStringOrEmpty(v: unknown): string {
  return v == null ? '' : String(v);
}

function toStringOrNull(v: unknown): string | null {
  return v == null || v === '' ? null : String(v);
}

// Skip sentinels sync to the hub like any answer value: SkipAffordance writes
// { __skipped: true, reason } for an individually skipped field, and
// StepGroup's removeBlock stamps { __skipped: true, reason: '__removed' } on
// every answered question of a removed repeater block. Either way the value
// carries no data — render it as an empty cell, never `[object Object]`.
// (Mirrors isSkipped in src/components/firstVisit/ProgressRing.tsx, kept local
// so the API route does not import a client component.)
function isSkippedValue(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { __skipped?: unknown }).__skipped === true
  );
}

// True when a field value would render as a non-empty cell.
function hasContent(v: unknown): boolean {
  return v != null && String(v).trim() !== '';
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ inspectionId: string }> },
) {
  const ctx = await getHubRouteContext(await getHubUserClient());
  if (!ctx) return new Response(JSON.stringify({ error: 'unauth' }), { status: 401 });
  const { supabase } = ctx;

  const { inspectionId } = await params;

  // Finding field answers for this inspection.
  const { data: answers, error: ansErr } = await supabase
    .from('first_visit_answers')
    .select('target_id, scope, question_key, step_index, value')
    .eq('inspection_id', inspectionId)
    .in('question_key', FINDING_FIELD_SLUGS as unknown as string[]);
  if (ansErr) return new Response(JSON.stringify({ error: ansErr.message }), { status: 500 });

  // Targets (for unit_identifier labels) keyed by id.
  const { data: targets } = await supabase
    .from('first_visit_targets')
    .select('id, label, kind')
    .eq('inspection_id', inspectionId);
  const targetById = new Map<string, { label: string | null; kind: string | null }>();
  for (const t of targets ?? []) {
    targetById.set(t.id, { label: t.label ?? null, kind: t.kind ?? null });
  }

  // Finding media rows for this inspection.
  const { data: media } = await supabase
    .from('first_visit_media')
    .select('target_id, question_key, storage_path, kind')
    .eq('inspection_id', inspectionId);

  // Group finding field answers by (target_id, step_index).
  type FindingAcc = {
    target_id: string;
    scope: string | null;
    step_index: number | null;
    fields: Record<string, unknown>;
  };
  const findings = new Map<string, FindingAcc>();
  const keyOf = (targetId: string, step: number | null) => `${targetId}::${step ?? 'null'}`;

  for (const a of answers ?? []) {
    const step = typeof a.step_index === 'number' ? a.step_index : null;
    // step_index < 0 is the server-side "not a repeater row" sentinel — such
    // answers are not issue-log entries, so keep them out of row grouping.
    if (step != null && step < 0) continue;
    const k = keyOf(a.target_id, step);
    let acc = findings.get(k);
    if (!acc) {
      acc = { target_id: a.target_id, scope: a.scope ?? null, step_index: step, fields: {} };
      findings.set(k, acc);
    }
    const canonicalKey = PROP_FIELD_TO_CANONICAL[a.question_key] ?? a.question_key;
    // A skipped/removed field carries no data — treat as empty.
    acc.fields[canonicalKey] = isSkippedValue(a.value) ? null : a.value;
  }

  // Index media by (target_id, parsed step index).
  const mediaByFinding = new Map<string, Array<{ storage_path: string; kind: string }>>();
  for (const m of media ?? []) {
    const step = parseFindingMediaStep(m.question_key ?? '');
    if (step == null) continue;
    const k = keyOf(m.target_id, step);
    const arr = mediaByFinding.get(k) ?? [];
    arr.push({ storage_path: m.storage_path, kind: m.kind });
    mediaByFinding.set(k, arr);
  }

  const rows: FindingRow[] = [];
  for (const [k, acc] of findings) {
    const f = acc.fields;
    // A removed repeater block leaves every field skipped (nulled above) — if
    // no field carries content, the issue was removed: emit no row at all.
    if (!Object.values(f).some(hasContent)) continue;
    const target = targetById.get(acc.target_id);
    const isBuilding = acc.scope === 'location' || target?.kind === 'property';
    const unit_identifier = isBuilding ? 'Building / common' : target?.label ?? '';

    // Sign media URLs (7-day expiry). Skip rows whose signing errors.
    const media_links: string[] = [];
    for (const item of mediaByFinding.get(k) ?? []) {
      const bucket = BUCKETS[item.kind];
      if (!bucket) continue;
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(item.storage_path, 60 * 60 * 24 * 7);
      if (error || !data?.signedUrl) continue;
      media_links.push(data.signedUrl);
    }

    rows.push({
      unit_identifier,
      item_name: toStringOrEmpty(f.issue_name),
      category: toStringOrEmpty(f.issue_type),
      location_in_unit: toStringOrNull(f.issue_location),
      resolution: toStringOrEmpty(f.issue_resolution),
      quantity: toNumberOrNull(f.issue_quantity),
      cost_estimate_eur: toNumberOrNull(f.issue_cost_estimate_eur),
      urgency: toStringOrNull(f.issue_urgency),
      notes: toStringOrNull(f.issue_notes),
      media_links,
    });
  }

  const csv = buildFindingsCsv(rows);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="findings-${inspectionId}.csv"`,
    },
  });
}
