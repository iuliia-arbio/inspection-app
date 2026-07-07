import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firstVisit/hubSupabase', () => ({ getHubSupabase: vi.fn() }));

import { POST } from '../route';
import { getHubSupabase } from '@/lib/firstVisit/hubSupabase';

function mockClient() {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  (getHubSupabase as never as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({ upsert }),
    auth: { getUser: () => ({ data: { user: { email: 'a@arbio.com' } } }) },
  });
  return upsert;
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request('http://x/api/first-visit/answers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/first-visit/answers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts answer keyed by (target_id, question_key, area_key, step_index)', async () => {
    const upsert = mockClient();

    const res = await post({
      id: 'ans1', inspection_id: 'i1', question_key: 'wifi',
      area_key: 'access', value: 'pw',
      was_prefilled: false, was_accepted_as_is: false,
    });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.anything(),
      { onConflict: 'target_id,question_key,area_key,step_index' },
    );
  });

  it('maps a null/absent step_index to the -1 sentinel', async () => {
    const upsert = mockClient();

    await post({
      id: 'ans1', inspection_id: 'i1', question_key: 'wifi',
      area_key: 'access', step_index: null, value: 'pw',
      was_prefilled: false, was_accepted_as_is: false,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ step_index: -1 }),
      expect.anything(),
    );
  });

  it('keeps distinct step_index values for repeater rows sharing a slug', async () => {
    const upsert = mockClient();

    await post({
      id: 'ans-step0', inspection_id: 'i1', target_id: 't1',
      question_key: 'issue_name', area_key: 'issues', step_index: 0,
      value: 'Broken lamp', was_prefilled: false, was_accepted_as_is: false,
    });
    await post({
      id: 'ans-step1', inspection_id: 'i1', target_id: 't1',
      question_key: 'issue_name', area_key: 'issues', step_index: 1,
      value: 'Stained sofa', was_prefilled: false, was_accepted_as_is: false,
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'ans-step0', question_key: 'issue_name', step_index: 0 }),
      expect.anything(),
    );
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'ans-step1', question_key: 'issue_name', step_index: 1 }),
      expect.anything(),
    );
  });
});
