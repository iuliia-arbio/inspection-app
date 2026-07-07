import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firstVisit/hubSupabase', () => ({ getHubSupabase: vi.fn() }));
vi.mock('@/lib/firstVisit/activityLog', () => ({ logValueSubmitted: vi.fn() }));

import { POST } from '../route';
import { getHubSupabase } from '@/lib/firstVisit/hubSupabase';
import { logValueSubmitted } from '@/lib/firstVisit/activityLog';

const inspectionRow = { id: 'i1', deal_id: 'd1' };

function makeClient(opts: {
  answers: unknown[];
  dataPoints?: unknown[];
  upsert?: ReturnType<typeof vi.fn>;
  inspectionUpdate?: ReturnType<typeof vi.fn>;
}) {
  const upsert = opts.upsert ?? vi.fn().mockResolvedValue({ error: null });
  const inspectionUpdate =
    opts.inspectionUpdate ?? vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
  const dataPointsEq = vi.fn().mockResolvedValue({ data: opts.dataPoints ?? [], error: null });
  const from = vi.fn((table: string) => {
    if (table === 'first_visit_inspections') {
      return {
        update: inspectionUpdate,
        select: () => ({ eq: () => ({ single: () => ({ data: inspectionRow, error: null }) }) }),
      };
    }
    if (table === 'first_visit_answers') {
      return { select: () => ({ eq: () => ({ data: opts.answers, error: null }) }) };
    }
    if (table === 'data_points') {
      return { select: () => ({ in: () => ({ eq: dataPointsEq }) }) };
    }
    if (table === 'data_point_values') {
      return { upsert };
    }
    return {};
  });
  const client = {
    from,
    auth: { getUser: () => ({ data: { user: { email: 'a@arbio.com' } } }) },
  };
  (getHubSupabase as never as ReturnType<typeof vi.fn>).mockReturnValue(client);
  return { upsert, inspectionUpdate, dataPointsEq };
}

function submitReq() {
  return new Request('http://x/api/first-visit/submit', {
    method: 'POST',
    body: JSON.stringify({ inspection_id: 'i1' }),
  });
}

describe('POST /api/first-visit/submit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes data_point_values for mapped answers, logs activity, reports counts', async () => {
    const { dataPointsEq } = makeClient({
      answers: [
        { question_key: 'beds', value: 2, data_point_slug: 'beds-count', scope: 'unit_category', unit_category_id: 'u1', step_index: -1 },
        { question_key: 'wifi', value: 'pw', data_point_slug: null, scope: 'deal', step_index: -1 },
      ],
      dataPoints: [{ id: 'dp1', slug: 'beds-count' }],
    });

    const res = await POST(submitReq());
    expect(res.status).toBe(200);
    expect(logValueSubmitted).toHaveBeenCalledOnce();
    // only active definitions are consulted
    expect(dataPointsEq).toHaveBeenCalledWith('active', true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pushed).toBe(1);
    expect(body.skipped).toEqual({ unknown_slugs: [], no_scope: 0, repeater_rows: 0 });
  });

  it('reports answers whose slug has no data_point definition instead of dropping silently', async () => {
    makeClient({
      answers: [
        { question_key: 'p3_parking__summary', value: 'text', data_point_slug: 'p3_parking__summary', scope: 'deal', step_index: -1 },
        { question_key: 'beds', value: 2, data_point_slug: 'beds-count', scope: 'unit_category', unit_category_id: 'u1', step_index: -1 },
      ],
      dataPoints: [{ id: 'dp1', slug: 'beds-count' }],
    });

    const res = await POST(submitReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pushed).toBe(1);
    expect(body.skipped.unknown_slugs).toEqual(['p3_parking__summary']);
  });

  it('packs repeater rows into one ordered array on the container data point', async () => {
    const { upsert } = makeClient({
      answers: [
        // out of order + multi-field, plus a soft-removed block that must be excluded
        { question_key: 'issue_name', value: 'Cracked tile', data_point_slug: 'issue_name', scope: 'unit_category', unit_category_id: 'u1', step_index: 1 },
        { question_key: 'issue_type', value: 'Damage', data_point_slug: 'issue_type', scope: 'unit_category', unit_category_id: 'u1', step_index: 1 },
        { question_key: 'issue_name', value: 'Broken lamp', data_point_slug: 'issue_name', scope: 'unit_category', unit_category_id: 'u1', step_index: 0 },
        { question_key: 'issue_name', value: { __skipped: true, reason: '__removed' }, data_point_slug: 'issue_name', scope: 'unit_category', unit_category_id: 'u1', step_index: 2 },
      ],
      dataPoints: [{ id: 'dpc', slug: 'fv_issues' }],
    });

    const res = await POST(submitReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      {
        data_point_id: 'dpc',
        scope_id: 'u1',
        source: 'staff_first_visit',
        value: [
          { name: 'Broken lamp' },
          { name: 'Cracked tile', type: 'Damage' },
        ],
      },
      { onConflict: 'data_point_id,scope_id,source' },
    );
    expect(body.pushed).toBe(1);
    expect(body.skipped.repeater_rows).toBe(1); // the removed-block sentinel row
  });

  it('routes building issues to fv_building_issues, not fv_issues', async () => {
    const { upsert } = makeClient({
      answers: [
        { question_key: 'prop_issue_name', value: 'Graffiti', data_point_slug: 'prop_issue_name', scope: 'location', location_id: 'l1', step_index: 0 },
      ],
      dataPoints: [{ id: 'dpb', slug: 'fv_building_issues' }, { id: 'dpc', slug: 'fv_issues' }],
    });

    const res = await POST(submitReq());
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ data_point_id: 'dpb', scope_id: 'l1', value: [{ name: 'Graffiti' }] }),
      expect.anything(),
    );
  });

  it('still skips-and-reports repeater groups without a container (check-in steps)', async () => {
    const { upsert } = makeClient({
      answers: [
        { question_key: 'fv_step_text', value: 'Enter code', data_point_slug: 'fv_step_text', scope: 'location', location_id: 'l1', step_index: 0 },
      ],
      dataPoints: [{ id: 'dps', slug: 'fv_step_text' }],
    });

    const res = await POST(submitReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
    expect(body.skipped.repeater_rows).toBe(1);
  });

  it('does not push a skip-sentinel single answer as a value', async () => {
    const { upsert } = makeClient({
      answers: [
        { question_key: 'beds', value: { __skipped: true, reason: 'n/a' }, data_point_slug: 'beds-count', scope: 'unit_category', unit_category_id: 'u1', step_index: -1 },
      ],
      dataPoints: [{ id: 'dp1', slug: 'beds-count' }],
    });

    const res = await POST(submitReq());
    expect(res.status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reports answers whose scope cannot be resolved', async () => {
    makeClient({
      answers: [
        // location-scoped answer missing its location_id → unresolvable
        { question_key: 'fv_wifi_ssid', value: 'net', data_point_slug: 'fv_wifi_ssid', scope: 'location', location_id: null, step_index: -1 },
      ],
      dataPoints: [{ id: 'dp3', slug: 'fv_wifi_ssid' }],
    });

    const res = await POST(submitReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.skipped.no_scope).toBe(1);
  });

  it('does NOT mark the inspection submitted when a value upsert fails, and returns 502', async () => {
    const { inspectionUpdate } = makeClient({
      answers: [
        { question_key: 'beds', value: 2, data_point_slug: 'beds-count', scope: 'unit_category', unit_category_id: 'u1', step_index: -1 },
      ],
      dataPoints: [{ id: 'dp1', slug: 'beds-count' }],
      upsert: vi.fn().mockResolvedValue({ error: { message: 'permission denied' } }),
    });

    const res = await POST(submitReq());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('partial-push-failure');
    expect(body.detail).toBe('permission denied');
    expect(body.failed).toBe(1);
    expect(inspectionUpdate).not.toHaveBeenCalled();
    expect(logValueSubmitted).not.toHaveBeenCalled();
  });
});
