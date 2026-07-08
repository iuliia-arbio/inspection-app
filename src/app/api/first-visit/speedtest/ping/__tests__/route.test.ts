import { describe, it, expect } from 'vitest';
import { GET } from '../route';

describe('speedtest ping route', () => {
  it('returns 204 immediately with no-store', async () => {
    const res = await GET();
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
