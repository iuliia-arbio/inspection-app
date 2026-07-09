// Fetches an inspection's media listing (hub metadata + signed download URLs)
// once and shares it across every MediaGallery on the page — a survey renders
// dozens of galleries, and each hitting /api/first-visit/media would sign the
// same URLs over and over. Signed URLs live 1h server-side; the cache expires
// well before that so a long-open page never holds dead links.

export type RemoteMedia = {
  id: string;
  inspection_id: string;
  target_id: string | null;
  answer_id: string | null;
  area_key: string;
  question_key: string | null;
  kind: 'photo' | 'video' | 'audio';
  captured_at: string;
  // Photos: null (use thumb_url / view_url instead). Video/audio: full signed URL.
  url: string | null;
  // Photos only: transformed signed URLs. thumb_url ~200px for the gallery tile,
  // view_url ~1080px for the tap-open modal. Null for video/audio.
  thumb_url: string | null;
  view_url: string | null;
};

const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { at: number; promise: Promise<RemoteMedia[]> }>();

export function getRemoteMedia(inspectionId: string): Promise<RemoteMedia[]> {
  const hit = cache.get(inspectionId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;

  const promise = fetch(`/api/first-visit/media?inspection_id=${encodeURIComponent(inspectionId)}`)
    .then((r) => (r.ok ? r.json() : { media: [] }))
    .then((body: { media?: RemoteMedia[] }) => body.media ?? [])
    .catch(() => {
      // Offline / expired session: behave as "no remote media" and let the
      // next render retry by dropping the cached failure.
      cache.delete(inspectionId);
      return [] as RemoteMedia[];
    });
  cache.set(inspectionId, { at: Date.now(), promise });
  return promise;
}

// Test hook.
export function clearRemoteMediaCache() {
  cache.clear();
}
