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
  const createSignedUrl = vi.fn(
    (
      bucket: string,
      path: string,
      _ttl: number,
      o?: { transform?: { width?: number } },
    ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> =>
      Promise.resolve({
        data: { signedUrl: `https://s/${bucket}/${path}?w=${o?.transform?.width ?? 0}` },
        error: null,
      }),
  );
  const storage = {
    from: (bucket: string) => ({
      createSignedUrls: (paths: string[], ttl: number) => createSignedUrls(bucket, paths, ttl),
      createSignedUrl: (path: string, ttl: number, o?: { transform?: { width?: number } }) =>
        createSignedUrl(bucket, path, ttl, o),
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
  return { createSignedUrls, createSignedUrl };
}

function req(inspectionId?: string) {
  const q = inspectionId ? `?inspection_id=${inspectionId}` : '';
  return new Request(`http://x/api/first-visit/media${q}`);
}

describe('GET /api/first-visit/media', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signs photos as thumb+view transforms and video as a plain URL', async () => {
    const { createSignedUrls, createSignedUrl } = makeClient({
      rows: [
        { id: 'm1', inspection_id: 'i1', target_id: 't1', answer_id: null, area_key: 'a', question_key: 'q', kind: 'photo', storage_path: 'i1/m1.jpg', captured_at: 'ts' },
        { id: 'm2', inspection_id: 'i1', target_id: 't1', answer_id: null, area_key: 'a', question_key: 'q', kind: 'video', storage_path: 'i1/m2.mp4', captured_at: 'ts' },
        // A row with no storage object at all — must come back all-null, not throw.
        { id: 'm3', inspection_id: 'i1', target_id: 't1', answer_id: null, area_key: 'a', question_key: 'q', kind: 'photo', storage_path: null, captured_at: 'ts' },
      ],
      signed: {
        'first-visit-videos': [{ path: 'i1/m2.mp4', signedUrl: 'https://s/v1' }],
      },
    });
    const res = await GET(req('i1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const photo = body.media.find((m: { id: string }) => m.id === 'm1');
    const video = body.media.find((m: { id: string }) => m.id === 'm2');
    // Photo: no full-res url, but thumb (small) + view (larger) transforms.
    expect(photo.url).toBeNull();
    expect(photo.thumb_url).toContain('w=200');
    expect(photo.view_url).toContain('w=1080');
    // Video: plain signed url, no transforms.
    expect(video.url).toBe('https://s/v1');
    expect(video.thumb_url).toBeNull();
    expect(video.view_url).toBeNull();
    // Null storage_path: nothing to sign — all URLs null.
    const nullPath = body.media.find((m: { id: string }) => m.id === 'm3');
    expect(nullPath.url).toBeNull();
    expect(nullPath.thumb_url).toBeNull();
    expect(nullPath.view_url).toBeNull();
    // Two transform sign calls for the one signable photo (thumb + view), none
    // for the video or the null-path photo.
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    // Video/audio still batch-signed per bucket.
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it('returns null transform URLs when a photo cannot be signed', async () => {
    const client = makeClient({
      rows: [
        { id: 'm1', inspection_id: 'i1', target_id: 't1', answer_id: null, area_key: 'a', question_key: 'q', kind: 'photo', storage_path: 'i1/gone.jpg', captured_at: 'ts' },
      ],
    });
    client.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'gone' } });
    const res = await GET(req('i1'));
    const body = await res.json();
    expect(body.media[0].thumb_url).toBeNull();
    expect(body.media[0].view_url).toBeNull();
  });

  it('400s without inspection_id and 401s without a session', async () => {
    makeClient({});
    expect((await GET(req())).status).toBe(400);
    makeClient({ user: null });
    expect((await GET(req('i1'))).status).toBe(401);
  });
});
