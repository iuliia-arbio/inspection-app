import { NextResponse } from 'next/server';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';

// Returns everything needed to rebuild the caller's visits on a fresh device:
// their inspections plus each inspection's targets and answers. Sync is
// otherwise one-way (device → hub), so this is the only download path — a
// device that lost its IndexedDB (in-app webview eviction, new phone, cleared
// site data) rehydrates from here. Media blobs are not included; they live in
// storage and the survey renders without them.
export async function GET() {
  const ctx = await getHubRouteContext(await getHubUserClient());
  if (!ctx) return NextResponse.json({ error: 'unauth' }, { status: 401 });
  const { supabase, email } = ctx;

  const { data: inspections, error: iErr } = await supabase
    .from('first_visit_inspections')
    .select('id, deal_id, status, inspector_email, started_at, submitted_at')
    .eq('inspector_email', email);
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  const ids = (inspections ?? []).map((i: { id: string }) => i.id);
  if (ids.length === 0) {
    return NextResponse.json({ inspections: [], targets: [], answers: [] });
  }

  const { data: targets, error: tErr } = await supabase
    .from('first_visit_targets')
    .select('id, inspection_id, kind, parent_id, location_id, unit_category_id, label, created_on_site, order')
    .in('inspection_id', ids);
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  const { data: answers, error: aErr } = await supabase
    .from('first_visit_answers')
    .select(
      'id, inspection_id, target_id, scope, location_id, unit_category_id, question_key, area_key, step_index, value, notes, data_point_slug, hub_suggestion_snapshot, was_prefilled, was_accepted_as_is, created_at, updated_at',
    )
    .in('inspection_id', ids);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  return NextResponse.json({
    inspections: inspections ?? [],
    targets: targets ?? [],
    answers: answers ?? [],
  });
}
