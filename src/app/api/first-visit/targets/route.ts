import { NextResponse } from 'next/server';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';

export async function POST(req: Request) {
  const ctx = await getHubRouteContext(await getHubUserClient());
  if (!ctx) return NextResponse.json({ error: 'unauth' }, { status: 401 });
  const { supabase } = ctx;

  const t = await req.json();
  const row = {
    id: t.id,
    inspection_id: t.inspection_id,
    kind: t.kind,
    parent_id: t.parent_id ?? null,
    location_id: t.location_id ?? null,
    unit_category_id: t.unit_category_id ?? null,
    label: t.label ?? null,
    created_on_site: !!t.created_on_site,
    order: t.order ?? 0,
  };
  const { error } = await supabase
    .from('first_visit_targets')
    .upsert(row, { onConflict: 'id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
