import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getRemoteMedia, clearRemoteMediaCache } from '../remoteMedia';

const ROW = {
  id: 'm1',
  inspection_id: 'i1',
  target_id: 't1',
  answer_id: null,
  area_key: 'kitchen',
  question_key: 'overall',
  kind: 'photo',
  captured_at: '2026-07-09T08:00:00.000Z',
  url: 'https://signed/url.jpg',
};

describe('getRemoteMedia', () => {
  beforeEach(() => clearRemoteMediaCache());
  afterEach(() => vi.unstubAllGlobals());

  it('fetches once per inspection and shares the result across callers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ media: [ROW] }) });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([getRemoteMedia('i1'), getRemoteMedia('i1')]);
    expect(a).toEqual([ROW]);
    expect(b).toEqual([ROW]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await getRemoteMedia('i2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns [] on failure and drops the cached failure so the next call retries', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getRemoteMedia('i1')).toEqual([]);

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ media: [ROW] }) });
    expect(await getRemoteMedia('i1')).toEqual([ROW]);
  });

  it('treats a non-OK response as empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    expect(await getRemoteMedia('i1')).toEqual([]);
  });
});
