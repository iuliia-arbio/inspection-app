import { describe, it, expect } from 'vitest';
import { GET } from '../route';

describe('speedtest download route', () => {
  it('streams the requested number of bytes', async () => {
    const req = new Request('http://localhost/api/first-visit/speedtest/download?bytes=1024');
    const res = await GET(req);
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBe(1024);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('caps bytes at a sane maximum to prevent abuse', async () => {
    const req = new Request('http://localhost/api/first-visit/speedtest/download?bytes=999999999999');
    const res = await GET(req);
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeLessThanOrEqual(50 * 1024 * 1024); // 50MB ceiling
  });
});
