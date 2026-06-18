import { NextResponse } from 'next/server';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';

export async function POST(req: Request) {
  const ctx = await getHubRouteContext(await getHubUserClient());
  if (!ctx) return NextResponse.json({ error: 'unauth' }, { status: 401 });
  const { supabase, email } = ctx;

  const body = await req.json();
  // The inspection is scoped to the deal only; properties/units live in
  // first_visit_targets. The legacy location_id/unit_category_id columns stay
  // on the table but we no longer write them.
  const row = {
    id: body.id,
    deal_id: body.deal_id,
    status: body.status ?? 'draft',
    inspector_email: email,
    started_at: body.started_at ?? new Date().toISOString(),
    submitted_at: body.submitted_at ?? null,
  };
  const { error } = await supabase.from('first_visit_inspections').upsert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
