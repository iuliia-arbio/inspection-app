import { NextResponse } from 'next/server';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';
import { randomUUID } from 'crypto';

const BUCKETS: Record<string, string> = {
  photo: 'first-visit-photos',
  video: 'first-visit-videos',
  audio: 'first-visit-audio',
};
const EXTS: Record<string, string> = {
  photo: 'jpg',
  video: 'mp4',
  audio: 'webm',
};

export async function POST(req: Request) {
  const auth = await getHubRouteContext(await getHubUserClient());
  if (!auth) return NextResponse.json({ error: 'unauth' }, { status: 401 });
  const { supabase } = auth;

  const { inspection_id, kind, content_hash } = await req.json();
  const bucket = BUCKETS[kind];
  if (!bucket) return NextResponse.json({ error: 'bad-kind' }, { status: 400 });

  const media_id = randomUUID();
  const path = `${inspection_id}/${media_id}.${EXTS[kind]}`;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    media_id,
    storage_path: path,
    bucket,
    signed_url: data.signedUrl,
    token: data.token,
    content_hash,
  });
}
