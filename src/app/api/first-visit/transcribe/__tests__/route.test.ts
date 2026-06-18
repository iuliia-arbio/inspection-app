// @vitest-environment node
// Server route test: use Node globals (undici Blob/FormData/Request) instead of
// jsdom's, whose Blob hangs undici's multipart formData() parser.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firstVisit/hubSupabaseServer', () => ({ getHubUserClient: vi.fn() }));
vi.mock('@/lib/firstVisit/hubSupabaseAdmin', () => ({ getHubRouteContext: vi.fn() }));

const transcribe = vi.fn();
const chat = vi.fn();
vi.mock('openai', () => ({
  default: class {
    audio = { transcriptions: { create: transcribe } };
    chat = { completions: { create: chat } };
  },
  toFile: vi.fn(async () => ({ name: 'audio.webm' })),
}));

import { POST } from '../route';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';

const asMock = (fn: unknown) => fn as never as ReturnType<typeof vi.fn>;

function makeRequest(file: Blob | null) {
  const form = new FormData();
  if (file) form.append('audio', file, 'clip.webm');
  return new Request('http://test/api/first-visit/transcribe', {
    method: 'POST',
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'sk-test';
  asMock(getHubRouteContext).mockResolvedValue({ supabase: {}, email: 'a@arbio.com' });
});

describe('POST /api/first-visit/transcribe', () => {
  it('401 when unauthenticated', async () => {
    asMock(getHubRouteContext).mockResolvedValue(null);
    const res = await POST(makeRequest(new Blob(['x'], { type: 'audio/webm' })));
    expect(res.status).toBe(401);
  });

  it('400 when no audio file is provided', async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(400);
  });

  it('413 when the audio exceeds the size limit', async () => {
    const big = new Blob(['x'], { type: 'audio/webm' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    // undici's multipart formData() re-parses the body and rebuilds the Blob,
    // dropping the overridden size — so hand the route a request whose
    // formData() yields the exact oversized Blob instance.
    const form = new FormData();
    form.append('audio', big, 'clip.webm');
    const req = new Request('http://test/api/first-visit/transcribe', { method: 'POST' });
    vi.spyOn(req, 'formData').mockResolvedValue(form);
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('transcribes then cleans, returning the cleaned text', async () => {
    transcribe.mockResolvedValue({ text: 'um the walls are uh clean no cracks' });
    chat.mockResolvedValue({
      choices: [{ message: { content: 'The walls are clean, no cracks.' } }],
    });
    const res = await POST(makeRequest(new Blob(['x'], { type: 'audio/webm' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'The walls are clean, no cracks.' });
    expect(transcribe).toHaveBeenCalledOnce();
    expect(chat).toHaveBeenCalledOnce();
  });

  it('returns empty text and skips cleanup when Whisper transcript is blank', async () => {
    transcribe.mockResolvedValue({ text: '   ' });
    const res = await POST(makeRequest(new Blob(['x'], { type: 'audio/webm' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: '' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('falls back to the raw transcript when cleanup fails', async () => {
    transcribe.mockResolvedValue({ text: 'walls are clean' });
    chat.mockRejectedValue(new Error('cleanup down'));
    const res = await POST(makeRequest(new Blob(['x'], { type: 'audio/webm' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'walls are clean' });
  });

  it('500 when transcription throws', async () => {
    transcribe.mockRejectedValue(new Error('whisper down'));
    const res = await POST(makeRequest(new Blob(['x'], { type: 'audio/webm' })));
    expect(res.status).toBe(500);
  });
});
