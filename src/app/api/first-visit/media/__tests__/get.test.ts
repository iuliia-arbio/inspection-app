import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firstVisit/hubSupabaseServer', () => ({ getHubUserClient: vi.fn() }));

import { GET } from '../route';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';

function makeClient(opts: {
  rows?: unknown[];
  signed?: Record<string, { path: string; signedUrl: string | null }[]>;
  user?: { email: string } | null;
}) {
  const from = vi.fn(() => ({
    select: () => ({ eq: vi.fn().mockResolvedValue({ data: opts.rows ?? [], error: null }) }),
  }));
  const createSignedUrls = vi.fn((bucket: string, _paths: string[], _ttl: number) =>
    Promise.resolve({ data: opts.signed?.[bucket] ?? [], error: null }),
  );
  const storage = {
    from: (bucket: string) => ({
      createSignedUrls: (paths: string[], ttl: number) => createSignedUrls(bucket, paths, ttl),
    }),
  };
  const client = {
    from,
    storage,
    auth: {
      getUser: () => ({
        data: { user: opts.user === null ? null : opts.user ?? { email: 'a@arbio.com' } },
      }),
    },
  };
  (getHubUserClient as never as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { createSignedUrls };
}

function req(inspectionId?: string) {
  const q = inspectionId ? `?inspection_id=${inspectionId}` : '';
  return new Request(`http://x/api/first-visit/media${q}`);
}

describe('GET /api/first-visit/media', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns rows with signed URLs, batched per bucket', async () => {
    const { createSignedUrls } = makeClient({
      rows: [
        { id: 'm1', inspection_id: 'i1', target_id: 't1', answer_id: null, area_key: 'a', question_key: 'q', kind: 'photo', storage_path: 'i1/m1.jpg', captured_at: 'ts' },
        { id: 'm2', inspection_id: 'i1', target_id: 't1', answer_id: null, area_key: 'a', question_key: 'q', kind: 'video', storage_path: 'i1/m2.mp4', captured_at: 'ts' },
      ],
      signed: {
        'first-visit-photos': [{ path: 'i1/m1.jpg', signedUrl: 'https://s/p1' }],
        'first-visit-videos': [{ path: 'i1/m2.mp4', signedUrl: 'https://s/v1' }],
      },
    });
    const res = await GET(req('i1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.media).toHaveLength(2);
    expect(body.media.find((m: { id: string }) => m.id === 'm1').url).toBe('https://s/p1');
    expect(body.media.find((m: { id: string }) => m.id === 'm2').url).toBe('https://s/v1');
    // One signing call per bucket, not per file.
    expect(createSignedUrls).toHaveBeenCalledTimes(2);
  });

  it('returns url:null for a row whose storage object could not be signed', async () => {
    makeClient({
      rows: [
        { id: 'm1', inspection_id: 'i1', target_id: 't1', answer_id: null, area_key: 'a', question_key: 'q', kind: 'photo', storage_path: 'i1/gone.jpg', captured_at: 'ts' },
      ],
      signed: { 'first-visit-photos': [] },
    });
    const res = await GET(req('i1'));
    const body = await res.json();
    expect(body.media[0].url).toBeNull();
  });

  it('400s without inspection_id and 401s without a session', async () => {
    makeClient({});
    expect((await GET(req())).status).toBe(400);
    makeClient({ user: null });
    expect((await GET(req('i1'))).status).toBe(401);
  });
});
