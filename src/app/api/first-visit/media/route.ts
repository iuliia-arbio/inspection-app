import { NextResponse } from 'next/server';
import { getHubUserClient } from '@/lib/firstVisit/hubSupabaseServer';
import { getHubRouteContext } from '@/lib/firstVisit/hubSupabaseAdmin';

const BUCKETS: Record<string, string> = {
  photo: 'first-visit-photos',
  video: 'first-visit-videos',
  audio: 'first-visit-audio',
};

const SIGNED_URL_TTL_S = 3600;

const THUMB = { width: 200, height: 200, resize: 'contain' as const };
const VIEW = { width: 1080, height: 1080, resize: 'contain' as const };

// Lists an inspection's media with signed download URLs so a device that
// didn't capture the files (other staff, restored device) can still view
// them. Blobs stay in storage — at ~5MB per photo, downloading them into
// every device's IndexedDB is not an option.
export async function GET(req: Request) {
  const auth = await getHubRouteContext(await getHubUserClient());
  if (!auth) return NextResponse.json({ error: 'unauth' }, { status: 401 });
  const { supabase } = auth;

  const inspection_id = new URL(req.url).searchParams.get('inspection_id');
  if (!inspection_id) return NextResponse.json({ error: 'missing-inspection_id' }, { status: 400 });

  const { data: rows, error } = await supabase
    .from('first_visit_media')
    .select('id, inspection_id, target_id, answer_id, area_key, question_key, kind, storage_path, captured_at')
    .eq('inspection_id', inspection_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Photos: sign a small thumbnail + a fit-to-screen view via image transforms.
  // The batch signer can't transform, so photos are signed per-file. Full-res
  // originals are never sent to the client (they OOM mobile Chrome on decode).
  const photoUrls = new Map<string, { thumb: string | null; view: string | null }>();
  await Promise.all(
    (rows ?? [])
      .filter((r) => r.kind === 'photo' && r.storage_path)
      .map(async (r) => {
        const path = r.storage_path as string;
        const [thumb, view] = await Promise.all([
          supabase.storage.from(BUCKETS.photo).createSignedUrl(path, SIGNED_URL_TTL_S, { transform: THUMB }),
          supabase.storage.from(BUCKETS.photo).createSignedUrl(path, SIGNED_URL_TTL_S, { transform: VIEW }),
        ]);
        // A failed sign degrades to a null URL for that photo, but log it so a
        // systemic failure (e.g. image transforms disabled on the project) is
        // visible server-side instead of silently blanking every photo.
        if (thumb.error) console.warn(`fv-media: thumb sign failed for ${path}: ${thumb.error.message}`);
        if (view.error) console.warn(`fv-media: view sign failed for ${path}: ${view.error.message}`);
        photoUrls.set(path, {
          thumb: thumb.data?.signedUrl ?? null,
          view: view.data?.signedUrl ?? null,
        });
      }),
  );

  // Video/audio: batch-sign per bucket (no transform available for them). A row
  // whose object went missing gets url:null rather than failing the listing.
  const urlByPath = new Map<string, string | null>();
  for (const bucket of new Set(
    (rows ?? []).filter((r) => r.kind !== 'photo').map((r) => BUCKETS[r.kind]).filter(Boolean),
  )) {
    const paths = (rows ?? [])
      .filter((r) => r.kind !== 'photo' && BUCKETS[r.kind] === bucket && r.storage_path)
      .map((r) => r.storage_path as string);
    if (paths.length === 0) continue;
    const { data: signed, error: signErr } = await supabase.storage
      .from(bucket)
      .createSignedUrls(paths, SIGNED_URL_TTL_S);
    if (signErr) return NextResponse.json({ error: signErr.message }, { status: 500 });
    for (const s of signed ?? []) urlByPath.set(s.path ?? '', s.signedUrl ?? null);
  }

  return NextResponse.json({
    media: (rows ?? []).map((r) => {
      const base = {
        id: r.id,
        inspection_id: r.inspection_id,
        target_id: r.target_id,
        answer_id: r.answer_id,
        area_key: r.area_key,
        question_key: r.question_key,
        kind: r.kind,
        captured_at: r.captured_at,
      };
      if (r.kind === 'photo') {
        const u = r.storage_path ? photoUrls.get(r.storage_path) : undefined;
        return { ...base, url: null, thumb_url: u?.thumb ?? null, view_url: u?.view ?? null };
      }
      return {
        ...base,
        url: r.storage_path ? urlByPath.get(r.storage_path) ?? null : null,
        thumb_url: null,
        view_url: null,
      };
    }),
  });
}

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
