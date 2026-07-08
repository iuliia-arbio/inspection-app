import { NextResponse } from 'next/server';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';
import { logValueSubmitted } from '@/lib/firstVisit/activityLog';
import { resolveScopeId, type HubScope } from '@/lib/firstVisit/resolveScope';

// Field-slug prefix → hub container data point the group is packed into.
// prop_issue_ must precede issue_ (prefix match). Check-in steps (fv_step_*)
// have no container in the registry and stay out of the push.
const REPEATER_CONTAINERS: Record<string, string> = {
  prop_issue_: 'fv_building_issues',
  issue_: 'fv_issues',
  item_: 'fv_items',
};

// Soft-removed repeater blocks / skipped fields store a sentinel object
// (mirrors isSkipped in ProgressRing.tsx and the findings.csv route).
function isSkippedValue(v: unknown): boolean {
  return typeof v === 'object' && v !== null && (v as { __skipped?: unknown }).__skipped === true;
}

export async function POST(req: Request) {
  const auth = await getHubRouteContext(await getHubUserClient());
  if (!auth) return NextResponse.json({ error: 'unauth' }, { status: 401 });
  const { supabase, email } = auth;

  const { inspection_id } = await req.json();

  const { data: inspection, error: iErr } = await supabase
    .from('first_visit_inspections')
    .select('id, deal_id')
    .eq('id', inspection_id)
    .single();
  if (iErr || !inspection) return NextResponse.json({ error: 'no-inspection' }, { status: 404 });

  const { data: answers, error: aErr } = await supabase
    .from('first_visit_answers')
    .select('question_key, area_key, scope, location_id, unit_category_id, value, data_point_slug, step_index')
    .eq('inspection_id', inspection_id);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  const slugs = (answers ?? [])
    .map((a) => a.data_point_slug)
    .filter((s): s is string => !!s)
    .concat(Object.values(REPEATER_CONTAINERS));
  let dataPoints: { id: string; slug: string }[] = [];
  if (slugs.length > 0) {
    const { data, error } = await supabase
      .from('data_points')
      .select('id, slug')
      .in('slug', slugs)
      .eq('active', true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    dataPoints = data ?? [];
  }
  const slugToDp = Object.fromEntries(dataPoints.map((dp) => [dp.slug, dp]));

  // Nothing here is destructive — every answer stays in first_visit_answers —
  // but the push into data_point_values used to drop answers silently. Count
  // every skip so the caller (and our logs) can see exactly what was left
  // behind, and fail the request when the hub itself errored so the outbox
  // retries instead of the inspection being marked submitted over a bad push.
  let pushed = 0;
  let repeaterRows = 0;
  let noScope = 0;
  let failed = 0;
  let firstFailure: string | null = null;
  const unknownSlugs = new Set<string>();

  const upsertValue = async (data_point_id: string, scope_id: string, value: unknown) => {
    const { error: upErr } = await supabase
      .from('data_point_values')
      .upsert({
        data_point_id,
        scope_id,
        source: 'staff_first_visit',
        value,
      }, { onConflict: 'data_point_id,scope_id,source' });
    if (upErr) {
      failed++;
      firstFailure ??= upErr.message;
      return;
    }
    pushed++;
    await logValueSubmitted(supabase, {
      data_point_id,
      scope_id,
      source: 'staff_first_visit',
      value,
      actor_name: email,
    });
  };

  // Repeater rows (step_index >= 0) share one slug per field, but
  // data_point_values holds a single value per (data_point, scope, source) —
  // pushing them individually would land ONE arbitrary row's value as "the"
  // value. Instead the whole group is packed into a single ordered array on
  // its container data point (fv_issues / fv_building_issues / fv_items),
  // keyed by (container, scope). Groups without a container (check-in steps)
  // stay out of the push and are reported.
  const groups = new Map<string, { dpId: string; scope_id: string; steps: Map<number, Record<string, unknown>> }>();

  for (const a of answers ?? []) {
    if (!a.data_point_slug) continue;
    // The answer carries its own scope; resolve the scope_id directly from the
    // answer's own location_id / unit_category_id (deal falls back to the
    // inspection's deal_id). data_points.level is no longer consulted.
    const scope_id = resolveScopeId(a.scope as HubScope, {
      deal_id: inspection.deal_id,
      location_id: a.location_id ?? undefined,
      unit_category_id: a.unit_category_id ?? undefined,
    });

    if (typeof a.step_index === 'number' && a.step_index >= 0) {
      const prefix = Object.keys(REPEATER_CONTAINERS).find((p) => a.data_point_slug!.startsWith(p));
      const containerDp = prefix ? slugToDp[REPEATER_CONTAINERS[prefix]] : undefined;
      if (!prefix || !containerDp || !scope_id || isSkippedValue(a.value)) {
        repeaterRows++;
        continue;
      }
      const key = `${containerDp.id}::${scope_id}`;
      let group = groups.get(key);
      if (!group) {
        group = { dpId: containerDp.id, scope_id, steps: new Map() };
        groups.set(key, group);
      }
      let step = group.steps.get(a.step_index);
      if (!step) {
        step = {};
        group.steps.set(a.step_index, step);
      }
      step[a.data_point_slug.slice(prefix.length)] = a.value;
      continue;
    }

    if (isSkippedValue(a.value)) continue; // deliberate skip — carries no value
    const dp = slugToDp[a.data_point_slug];
    if (!dp) {
      unknownSlugs.add(a.data_point_slug);
      continue;
    }
    if (!scope_id) {
      noScope++;
      continue;
    }
    await upsertValue(dp.id, scope_id, a.value);
  }

  for (const group of groups.values()) {
    const value = [...group.steps.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, fields]) => fields)
      .filter((fields) => Object.keys(fields).length > 0);
    if (value.length === 0) continue;
    await upsertValue(group.dpId, group.scope_id, value);
  }

  const skipped = {
    unknown_slugs: [...unknownSlugs].sort(),
    no_scope: noScope,
    repeater_rows: repeaterRows,
  };

  // Hub write errors are transient/fixable — leave the inspection unsubmitted
  // so the outbox job retries (the upserts above are idempotent).
  if (failed > 0) {
    return NextResponse.json(
      { ok: false, error: 'partial-push-failure', detail: firstFailure, pushed, failed, skipped },
      { status: 502 },
    );
  }

  const { error: subErr } = await supabase
    .from('first_visit_inspections')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', inspection_id);
  if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, pushed, skipped });
}
