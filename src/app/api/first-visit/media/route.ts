import { NextResponse } from 'next/server';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';

export async function POST(req: Request) {
  const auth = await getHubRouteContext(await getHubUserClient());
  if (!auth) return NextResponse.json({ error: 'unauth' }, { status: 401 });
  const { supabase } = auth;

  const m = await req.json();
  const BUCKETS: Record<string, string> = {
    photo: 'first-visit-photos',
    video: 'first-visit-videos',
    audio: 'first-visit-audio',
  };

  // Verify upload exists in storage (HEAD via list).
  const folder = m.storage_path.split('/').slice(0, -1).join('/');
  const filename = m.storage_path.split('/').pop();
  const { data: listed, error: listErr } = await supabase.storage
    .from(BUCKETS[m.kind])
    .list(folder, { search: filename });
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });

  const match = listed?.find((f) => f.name === filename);
  if (!match) return NextResponse.json({ error: 'not-uploaded' }, { status: 400 });
  // Storage list returns metadata in `metadata.size` for newer SDKs.
  const sizeOk = !m.size_bytes || match.metadata?.size === m.size_bytes;
  if (!sizeOk) return NextResponse.json({ error: 'size-mismatch' }, { status: 400 });

  const { error } = await supabase.from('first_visit_media').insert({
    id: m.id,
    inspection_id: m.inspection_id,
    target_id: m.target_id ?? null,
    answer_id: m.answer_id ?? null,
    area_key: m.area_key,
    question_key: m.question_key ?? null,
    kind: m.kind,
    storage_path: m.storage_path,
    content_hash: m.content_hash,
    size_bytes: m.size_bytes,
    captured_at: m.captured_at,
    uploaded_at: new Date().toISOString(),
    verified_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await getHubRouteContext(await getHubUserClient());
  if (!auth) return NextResponse.json({ error: 'unauth' }, { status: 401 });
  const { supabase } = auth;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing-id' }, { status: 400 });

  // Look up the row first so we can also remove the underlying storage object.
  const { data: row, error: selErr } = await supabase
    .from('first_visit_media')
    .select('kind, storage_path')
    .eq('id', id)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  if (row) {
    const BUCKETS: Record<string, string> = {
      photo: 'first-visit-photos',
      video: 'first-visit-videos',
      audio: 'first-visit-audio',
    };
    const bucket = BUCKETS[row.kind];
    if (bucket && row.storage_path) {
      // Best-effort storage cleanup; a missing object should not block the
      // metadata delete (the job must be able to succeed and drain).
      await supabase.storage.from(bucket).remove([row.storage_path]);
    }
  }

  const { error } = await supabase
    .from('first_visit_media')
    .delete()
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
