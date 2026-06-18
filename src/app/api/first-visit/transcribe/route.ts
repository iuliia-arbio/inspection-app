import OpenAI, { toFile } from 'openai';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';
import { loadOpenAIKey } from '@/lib/openaiKey';
import {
  CLEANUP_SYSTEM_PROMPT,
  CLEANUP_MODEL,
  TRANSCRIBE_MODEL,
} from '@/lib/firstVisit/cleanupPrompt';

// Whisper + a gpt-4o-mini cleanup pass run sequentially; give the function
// headroom over the platform default. Mirrors inspections/[id]/route.ts.
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB — Whisper's upload ceiling

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export async function POST(req: Request): Promise<Response> {
  const ctx = await getHubRouteContext(await getHubUserClient());
  if (!ctx) return json({ error: 'unauth' }, 401);

  const form = await req.formData();
  const audio = form.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) {
    return json({ error: 'no audio' }, 400);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return json({ error: 'audio too large' }, 413);
  }

  loadOpenAIKey();
  if (!process.env.OPENAI_API_KEY) return json({ error: 'no key' }, 500);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let raw: string;
  try {
    // Pass the Blob straight to toFile (it reads via .text()/.slice()); avoids
    // a manual arrayBuffer() round-trip that hangs under jsdom in tests.
    const file = await toFile(audio, 'clip.webm', { type: 'audio/webm' });
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: TRANSCRIBE_MODEL,
    });
    raw = (transcription.text ?? '').trim();
  } catch (err) {
    console.error('Whisper transcription failed:', err);
    const e = err as { message?: string; code?: string };
    return json(
      { error: 'transcription failed', detail: e?.message ?? String(err), code: e?.code ?? null },
      500,
    );
  }

  if (!raw) return json({ text: '' });

  // Cleanup pass. On any failure, fall back to the raw transcript so the
  // inspector never loses what they said.
  let cleaned = raw;
  try {
    const completion = await openai.chat.completions.create({
      model: CLEANUP_MODEL,
      messages: [
        { role: 'system', content: CLEANUP_SYSTEM_PROMPT },
        { role: 'user', content: raw },
      ],
    });
    const out = completion.choices[0]?.message?.content?.trim();
    if (out) cleaned = out;
  } catch (err) {
    console.error('Cleanup pass failed, returning raw transcript:', err);
  }

  return json({ text: cleaned });
}
