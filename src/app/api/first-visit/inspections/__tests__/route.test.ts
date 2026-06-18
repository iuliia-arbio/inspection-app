import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firstVisit/hubSupabaseServer', () => ({
  getHubUserClient: vi.fn(),
}));

import { POST } from '../route';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';

describe('POST /api/first-visit/inspections', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts an inspection row', async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    (getHubUserClient as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn().mockReturnValue({ upsert }),
      auth: { getUser: () => ({ data: { user: { email: 'a@arbio.com' } } }) },
    });

    const req = new Request('http://x/api/first-visit/inspections', {
      method: 'POST',
      body: JSON.stringify({
        id: 'i1', deal_id: 'd1', location_id: 'l1',
        unit_category_id: 'u1', status: 'draft',
        started_at: new Date().toISOString(),
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalled();
  });
});
