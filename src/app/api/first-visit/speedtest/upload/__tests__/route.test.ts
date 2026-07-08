import { describe, it, expect } from 'vitest';
import { POST } from '../route';

describe('speedtest upload route', () => {
  it('accepts a POST body and returns the byte count received', async () => {
    const body = new Uint8Array(2048);
    const req = new Request('http://localhost/api/first-visit/speedtest/upload', {
      method: 'POST',
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bytesReceived).toBe(2048);
  });
});
