import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firstVisit/hubSupabaseServer', () => ({ getHubUserClient: vi.fn() }));

import { GET } from '../route';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';

// Chainable query mock: select/neq/in/order return the builder; range(from, to)
// resolves the corresponding slice of `rows`, mirroring PostgREST paging.
function makeTable(rows: unknown[], rangeSpy?: (from: number, to: number) => void) {
  const builder = {
    select: () => builder,
    neq: () => builder,
    in: () => builder,
    order: () => builder,
    range: (from: number, to: number) => {
      rangeSpy?.(from, to);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
  return builder;
}

function makeClient(opts: {
  inspections?: unknown[];
  targets?: unknown[];
  answers?: unknown[];
  answersRangeSpy?: (from: number, to: number) => void;
  user?: { email: string } | null;
}) {
  const from = vi.fn((table: string) => {
    if (table === 'first_visit_inspections') return makeTable(opts.inspections ?? []);
    if (table === 'first_visit_targets') return makeTable(opts.targets ?? []);
    if (table === 'first_visit_answers')
      return makeTable(opts.answers ?? [], opts.answersRangeSpy);
    return {};
  });
  const client = {
    from,
    auth: {
      getUser: () => ({
        data: { user: opts.user === null ? null : opts.user ?? { email: 'a@arbio.com' } },
      }),
    },
  };
  (getHubUserClient as never as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { from };
}

describe('GET /api/first-visit/restore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all non-discarded visits with their targets and answers', async () => {
    makeClient({
      inspections: [{ id: 'i1', deal_id: 'd1', status: 'submitted' }],
      targets: [{ id: 't1', inspection_id: 'i1' }],
      answers: [{ id: 'a1', inspection_id: 'i1' }],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inspections).toHaveLength(1);
    expect(body.targets).toHaveLength(1);
    expect(body.answers).toHaveLength(1);
  });

  it('pages past the 1000-row cap instead of silently truncating', async () => {
    const answersRangeSpy = vi.fn<(from: number, to: number) => void>();
    makeClient({
      inspections: [{ id: 'i1', deal_id: 'd1', status: 'submitted' }],
      targets: [],
      answers: Array.from({ length: 2500 }, (_, n) => ({ id: `a${n}`, inspection_id: 'i1' })),
      answersRangeSpy,
    });
    const res = await GET();
    const body = await res.json();
    expect(body.answers).toHaveLength(2500);
    // 3 full/partial pages: 0-999, 1000-1999, 2000-2999.
    expect(answersRangeSpy.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('short-circuits with empty arrays when there are no visits', async () => {
    const { from } = makeClient({ inspections: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ inspections: [], targets: [], answers: [] });
    // Only the inspections table was queried.
    expect(from.mock.calls.map((c) => c[0])).toEqual(['first_visit_inspections']);
  });

  it('401s without a session', async () => {
    makeClient({ user: null });
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
