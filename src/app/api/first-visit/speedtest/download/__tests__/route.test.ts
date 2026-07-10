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
    expect(Number(res.headers.get('content-length'))).toBeLessThanOrEqual(100 * 1024 * 1024); // 100MiB ceiling
  });

  it('honors LibreSpeed ckSize (mebibytes): ckSize=20 streams 20 MiB', async () => {
    const req = new Request('http://localhost/api/first-visit/speedtest/download?r=0.123&ckSize=20');
    const res = await GET(req);
    expect(res.headers.get('content-length')).toBe(String(20 * 1024 * 1024));
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('actually streams the ckSize payload, not just the header', async () => {
    const req = new Request('http://localhost/api/first-visit/speedtest/download?ckSize=1');
    const res = await GET(req);
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBe(1024 * 1024);
  });

  it('clamps absurd ckSize to the 100 MiB ceiling', async () => {
    const req = new Request('http://localhost/api/first-visit/speedtest/download?ckSize=9999');
    const res = await GET(req);
    expect(res.headers.get('content-length')).toBe(String(100 * 1024 * 1024));
  });

  it('clamps ckSize=0 and garbage values up to the 1 MiB floor', async () => {
    for (const v of ['0', '-5', 'banana']) {
      const res = await GET(new Request(`http://localhost/api/first-visit/speedtest/download?ckSize=${v}`));
      expect(res.headers.get('content-length')).toBe(String(1024 * 1024));
    }
  });

  it('ckSize takes precedence over bytes when both are present', async () => {
    const req = new Request('http://localhost/api/first-visit/speedtest/download?ckSize=2&bytes=1024');
    const res = await GET(req);
    expect(res.headers.get('content-length')).toBe(String(2 * 1024 * 1024));
  });
});
