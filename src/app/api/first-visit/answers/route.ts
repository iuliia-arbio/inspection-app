import { NextResponse } from 'next/server';
import { getHubSupabase } from '@/lib/firstVisit/hubSupabase';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';

export async function POST(req: Request) {
  const ctx = await getHubRouteContext(getHubSupabase());
  if (!ctx) return NextResponse.json({ error: 'unauth' }, { status: 401 });
  const { supabase } = ctx;

  const a = await req.json();
  // step_index coordinate for block-repeater answers. Accepted as a finite
  // number; anything else (undefined, null, string, NaN) collapses to the -1
  // sentinel so the NOT NULL column joins the unique index cleanly (Postgres
  // treats NULLs as distinct, so null could not participate in dedupe).
  const stepIndex =
    typeof a.step_index === 'number' && Number.isFinite(a.step_index)
      ? a.step_index
      : -1;
  const row = {
    id: a.id,
    inspection_id: a.inspection_id,
    target_id: a.target_id ?? null,
    scope: a.scope ?? null,
    location_id: a.location_id ?? null,
    unit_category_id: a.unit_category_id ?? null,
    question_key: a.question_key,
    area_key: a.area_key,
    step_index: stepIndex,
    value: a.value ?? null,
    notes: a.notes ?? null,
    data_point_slug: a.data_point_slug ?? null,
    hub_suggestion_snapshot: a.hub_suggestion_snapshot ?? null,
    was_prefilled: !!a.was_prefilled,
    was_accepted_as_is: !!a.was_accepted_as_is,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('first_visit_answers')
    .upsert(row, { onConflict: 'target_id,question_key,area_key,step_index' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
