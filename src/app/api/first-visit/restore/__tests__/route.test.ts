import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firstVisit/hubSupabaseServer', () => ({ getHubUserClient: vi.fn() }));

import { GET } from '../route';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';

function makeClient(opts: {
  inspections?: unknown[];
  targets?: unknown[];
  answers?: unknown[];
  user?: { email: string } | null;
}) {
  const inspectionsEq = vi
    .fn()
    .mockResolvedValue({ data: opts.inspections ?? [], error: null });
  const targetsIn = vi.fn().mockResolvedValue({ data: opts.targets ?? [], error: null });
  const answersIn = vi.fn().mockResolvedValue({ data: opts.answers ?? [], error: null });
  const from = vi.fn((table: string) => {
    if (table === 'first_visit_inspections') {
      return { select: () => ({ eq: inspectionsEq }) };
    }
    if (table === 'first_visit_targets') {
      return { select: () => ({ in: targetsIn }) };
    }
    if (table === 'first_visit_answers') {
      return { select: () => ({ in: answersIn }) };
    }
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
  return { inspectionsEq, targetsIn, answersIn };
}

describe('GET /api/first-visit/restore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the caller inspections with their targets and answers', async () => {
    const { inspectionsEq, targetsIn, answersIn } = makeClient({
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
    expect(inspectionsEq).toHaveBeenCalledWith('inspector_email', 'a@arbio.com');
    expect(targetsIn).toHaveBeenCalledWith('inspection_id', ['i1']);
    expect(answersIn).toHaveBeenCalledWith('inspection_id', ['i1']);
  });

  it('short-circuits with empty arrays when the caller has no inspections', async () => {
    const { targetsIn, answersIn } = makeClient({ inspections: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ inspections: [], targets: [], answers: [] });
    expect(targetsIn).not.toHaveBeenCalled();
    expect(answersIn).not.toHaveBeenCalled();
  });

  it('401s without a session', async () => {
    makeClient({ user: null });
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
