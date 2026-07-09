import { NextResponse } from 'next/server';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';

// Returns every visit (all inspectors, drafts and submitted) with targets and
// answers. Visits are shared across staff — any logged-in user sees all of
// them — and sync is otherwise one-way (device → hub), so this is the only
// download path: the visits list hydrates from here on load, which also
// rebuilds a device that lost its IndexedDB (in-app webview eviction, new
// phone, cleared site data). Media blobs are not included; they live in
// storage and the survey renders without them.
// Supabase caps a query at 1000 rows; a single select over answers would
// silently truncate once the table outgrows that (417 rows as of 2026-07-09).
// Page by .range() until a short page proves we drained the table.
const PAGE = 1000;
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return { rows, error: null };
  }
}

export async function GET() {
  const ctx = await getHubRouteContext(await getHubUserClient());
  if (!ctx) return NextResponse.json({ error: 'unauth' }, { status: 401 });
  const { supabase } = ctx;

  const inspections = await fetchAll<{ id: string }>((from, to) =>
    supabase
      .from('first_visit_inspections')
      .select('id, deal_id, status, inspector_email, started_at, submitted_at')
      .neq('status', 'discarded')
      .order('id')
      .range(from, to),
  );
  if (inspections.error) return NextResponse.json({ error: inspections.error }, { status: 500 });

  const ids = inspections.rows.map((i) => i.id);
  if (ids.length === 0) {
    return NextResponse.json({ inspections: [], targets: [], answers: [] });
  }

  const targets = await fetchAll((from, to) =>
    supabase
      .from('first_visit_targets')
      .select('id, inspection_id, kind, parent_id, location_id, unit_category_id, label, created_on_site, order')
      .in('inspection_id', ids)
      .order('id')
      .range(from, to),
  );
  if (targets.error) return NextResponse.json({ error: targets.error }, { status: 500 });

  const answers = await fetchAll((from, to) =>
    supabase
      .from('first_visit_answers')
      .select(
        'id, inspection_id, target_id, scope, location_id, unit_category_id, question_key, area_key, step_index, value, notes, data_point_slug, hub_suggestion_snapshot, was_prefilled, was_accepted_as_is, created_at, updated_at',
      )
      .in('inspection_id', ids)
      .order('id')
      .range(from, to),
  );
  if (answers.error) return NextResponse.json({ error: answers.error }, { status: 500 });

  return NextResponse.json({
    inspections: inspections.rows,
    targets: targets.rows,
    answers: answers.rows,
  });
}
