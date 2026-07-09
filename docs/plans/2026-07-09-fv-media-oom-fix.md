# Cross-Device Media OOM Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop mobile Chrome from OOM-crashing when opening a unit/property by never loading full-resolution remote media into the gallery — show tiny transformed thumbnails, load a fit-to-screen size only in the tap-open modal, and make remote videos tap-to-load.

**Architecture:** The `/api/first-visit/media` route already signs remote storage objects. Change it to return, per photo, a `thumb_url` (~200px) and `view_url` (~1080px) using Supabase image transforms instead of the full original. `MediaGallery` renders `thumb_url` in tiles and `view_url` in the modal; remote videos/audio render as a placeholder tile whose real `<video>`/`<audio>` (with `preload="none"`) mounts only when the modal opens.

**Tech Stack:** Next.js App Router route handlers, Supabase JS storage (`createSignedUrl` with `transform`, `createSignedUrls` batch), React client component, Vitest + Testing Library (jsdom).

**Design doc:** `docs/plans/2026-07-09-fv-media-oom-fix-design.md`

**Branch:** `feat/fv-cloud-restore` (regression from `e052599` lives here; PR #29 open).

**Testing note:** Per repo convention, NEVER run more than one vitest at a time. Use `npx vitest run --pool=forks <path>`.

---

## Background for the implementer (read once)

- **Why this crash happens:** an `<img>` shown at 64px still decodes its *source*
  pixels into an uncompressed bitmap (width × height × 4 bytes). A 12MP phone
  photo = ~48 MB regardless of display size. Rendering a phase's worth of remote
  full-res photos + `<video>` elements exhausts the mobile renderer → Chrome
  kills the tab and shows "Can't open this page".
- **Verified precondition:** Supabase image transforms are enabled on the hub
  project. A 200px transform of a real photo returned 6 KB vs 2.68 MB original.
- **Supabase API detail:** the batch `createSignedUrls(paths, ttl)` does NOT
  accept a transform option — only the single `createSignedUrl(path, ttl, {
  transform })` does. So photos must be signed per-file; video/audio stay batch.
  `createSignedUrl` resolves to `{ data: { signedUrl } | null, error }`.

---

## Task 1: Extend the `RemoteMedia` type

**Files:**
- Modify: `src/lib/firstVisit/remoteMedia.ts`
- Test: `src/lib/firstVisit/__tests__/remoteMedia.test.ts`

**Step 1: Update the existing test fixture to carry the new fields**

In `remoteMedia.test.ts`, add `thumb_url` and `view_url` to the `ROW` constant so
the passthrough is asserted:

```ts
const ROW = {
  id: 'm1',
  inspection_id: 'i1',
  target_id: 't1',
  answer_id: null,
  area_key: 'kitchen',
  question_key: 'overall',
  kind: 'photo',
  captured_at: '2026-07-09T08:00:00.000Z',
  url: null,
  thumb_url: 'https://signed/thumb.jpg',
  view_url: 'https://signed/view.jpg',
};
```

**Step 2: Run the test to verify it still passes structurally**

Run: `npx vitest run --pool=forks src/lib/firstVisit/__tests__/remoteMedia.test.ts`
Expected: PASS (the cache/fetch logic is unchanged; this just proves the fixture
round-trips). If TypeScript complains that `thumb_url`/`view_url` aren't on the
type, that's expected until Step 3.

**Step 3: Add the fields to the type**

In `src/lib/firstVisit/remoteMedia.ts`, extend the `RemoteMedia` type:

```ts
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
```

No change to `getRemoteMedia` logic — it passes the body through.

**Step 4: Run the test**

Run: `npx vitest run --pool=forks src/lib/firstVisit/__tests__/remoteMedia.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/firstVisit/remoteMedia.ts src/lib/firstVisit/__tests__/remoteMedia.test.ts
git commit -m "feat(fv): add thumb_url/view_url to RemoteMedia type"
```

---

## Task 2: Media route returns transformed thumb/view URLs for photos

**Files:**
- Modify: `src/app/api/first-visit/media/route.ts` (GET handler only)
- Test: `src/app/api/first-visit/media/__tests__/get.test.ts`

**Step 1: Extend the test mock to support single transform signing**

In `get.test.ts`, extend `makeClient` so the storage mock also exposes
`createSignedUrl` (single, with transform). Return a URL that encodes the
requested width so the test can assert thumb vs view:

```ts
function makeClient(opts: {
  rows?: unknown[];
  signed?: Record<string, { path: string; signedUrl: string | null }[]>;
  user?: { email: string } | null;
}) {
  const from = vi.fn(() => ({
    select: () => ({ eq: vi.fn().mockResolvedValue({ data: opts.rows ?? [], error: null }) }),
  }));
  const createSignedUrls = vi.fn((bucket: string, _paths: string[], _ttl: number) =>
    Promise.resolve({ data: opts.signed?.[bucket] ?? [], error: null }),
  );
  const createSignedUrl = vi.fn(
    (bucket: string, path: string, _ttl: number, o?: { transform?: { width?: number } }) =>
      Promise.resolve({
        data: { signedUrl: `https://s/${bucket}/${path}?w=${o?.transform?.width ?? 0}` },
        error: null,
      }),
  );
  const storage = {
    from: (bucket: string) => ({
      createSignedUrls: (paths: string[], ttl: number) => createSignedUrls(bucket, paths, ttl),
      createSignedUrl: (path: string, ttl: number, o?: { transform?: { width?: number } }) =>
        createSignedUrl(bucket, path, ttl, o),
    }),
  };
  const client = {
    from,
    storage,
    auth: {
      getUser: () => ({
        data: { user: opts.user === null ? null : opts.user ?? { email: 'a@arbio.com' } },
      }),
    },
  };
  (getHubUserClient as never as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { createSignedUrls, createSignedUrl };
}
```

**Step 2: Rewrite the "batched per bucket" test to assert the new shape**

Replace the first test body so photos assert `thumb_url`/`view_url` (and
`url: null`), and video still asserts a plain `url`:

```ts
  it('signs photos as thumb+view transforms and video as a plain URL', async () => {
    const { createSignedUrls, createSignedUrl } = makeClient({
      rows: [
        { id: 'm1', inspection_id: 'i1', target_id: 't1', answer_id: null, area_key: 'a', question_key: 'q', kind: 'photo', storage_path: 'i1/m1.jpg', captured_at: 'ts' },
        { id: 'm2', inspection_id: 'i1', target_id: 't1', answer_id: null, area_key: 'a', question_key: 'q', kind: 'video', storage_path: 'i1/m2.mp4', captured_at: 'ts' },
      ],
      signed: {
        'first-visit-videos': [{ path: 'i1/m2.mp4', signedUrl: 'https://s/v1' }],
      },
    });
    const res = await GET(req('i1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const photo = body.media.find((m: { id: string }) => m.id === 'm1');
    const video = body.media.find((m: { id: string }) => m.id === 'm2');
    // Photo: no full-res url, but thumb (small) + view (larger) transforms.
    expect(photo.url).toBeNull();
    expect(photo.thumb_url).toContain('w=200');
    expect(photo.view_url).toContain('w=1080');
    // Video: plain signed url, no transforms.
    expect(video.url).toBe('https://s/v1');
    expect(video.thumb_url).toBeNull();
    expect(video.view_url).toBeNull();
    // Two transform sign calls for the one photo (thumb + view), none for video.
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    // Video/audio still batch-signed per bucket.
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
  });
```

Update the "url:null for a missing object" test so the photo case checks the
transform path returning null:

```ts
  it('returns null transform URLs when a photo cannot be signed', async () => {
    const client = makeClient({
      rows: [
        { id: 'm1', inspection_id: 'i1', target_id: 't1', answer_id: null, area_key: 'a', question_key: 'q', kind: 'photo', storage_path: 'i1/gone.jpg', captured_at: 'ts' },
      ],
    });
    // Force the transform signer to error for this test.
    client.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'gone' } });
    const res = await GET(req('i1'));
    const body = await res.json();
    expect(body.media[0].thumb_url).toBeNull();
    expect(body.media[0].view_url).toBeNull();
  });
```

Leave the 400/401 test unchanged.

**Step 3: Run the tests to verify they fail**

Run: `npx vitest run --pool=forks src/app/api/first-visit/media/__tests__/get.test.ts`
Expected: FAIL — the route still returns `url` for photos and no `thumb_url`/`view_url`.

**Step 4: Implement the route change**

In `src/app/api/first-visit/media/route.ts`, replace the GET body's signing +
response section (keep `BUCKETS`, `SIGNED_URL_TTL_S`, auth, the row select, and
the error guard as-is). Add transform constants near the top:

```ts
const THUMB = { width: 200, height: 200, resize: 'contain' as const };
const VIEW = { width: 1080, height: 1080, resize: 'contain' as const };
```

Replace the per-bucket signing loop and the final `NextResponse.json` with:

```ts
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
        photoUrls.set(path, {
          thumb: thumb.data?.signedUrl ?? null,
          view: view.data?.signedUrl ?? null,
        });
      }),
  );

  // Video/audio: batch-sign per bucket (no transform available for them).
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
```

**Step 5: Run the tests**

Run: `npx vitest run --pool=forks src/app/api/first-visit/media/__tests__/get.test.ts`
Expected: PASS (all cases).

**Step 6: Commit**

```bash
git add src/app/api/first-visit/media/route.ts src/app/api/first-visit/media/__tests__/get.test.ts
git commit -m "feat(fv): media route signs photo thumb+view transforms instead of full-res

Full-res originals decode to ~48MB bitmaps and OOM mobile Chrome. Photos now
return a ~200px thumb_url + ~1080px view_url via Supabase image transforms;
video/audio keep batch-signed plain URLs."
```

---

## Task 3: MediaGallery — thumbnails, remote-video placeholder, modal view_url

**Files:**
- Modify: `src/components/firstVisit/MediaGallery.tsx`
- Test: `src/components/firstVisit/__tests__/MediaGallery.test.tsx`

**Step 1: Update the remote-media test fixture + assertions**

In `MediaGallery.test.tsx`, add the new fields to `remoteRow` and change the
existing remote assertion to expect the thumbnail in the tile:

```ts
    const remoteRow = {
      id: 'remote-1',
      inspection_id: INSPECTION,
      target_id: TARGET,
      answer_id: null,
      area_key: AREA,
      question_key: QUESTION,
      kind: 'photo',
      captured_at: '2026-07-09T08:00:00.000Z',
      url: null,
      thumb_url: 'https://hub/signed/remote-1-thumb.jpg',
      view_url: 'https://hub/signed/remote-1-view.jpg',
    };
```

In "renders remote rows view-only and counts them", change the src assertion:

```ts
      // Tile shows the small thumbnail, not a full-res image.
      expect(screen.getByRole('img')).toHaveAttribute('src', remoteRow.thumb_url);
```

**Step 2: Add a test for the remote-video placeholder (no eager `<video>`)**

Add inside the `remote media` describe:

```ts
    it('renders a remote video as a placeholder, not an eager <video>', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            media: [
              {
                ...remoteRow,
                id: 'remote-vid',
                kind: 'video',
                url: 'https://hub/signed/remote-vid.mp4',
                thumb_url: null,
                view_url: null,
              },
            ],
          }),
        }),
      );

      render(
        <MediaGallery
          inspectionId={INSPECTION}
          targetId={TARGET}
          areaKey={AREA}
          questionKey={QUESTION}
        />,
      );

      await waitFor(() => expect(screen.getByText(/1 file/i)).toBeInTheDocument());
      // No <video> is mounted in the gallery for a remote video (avoids buffering).
      expect(document.querySelector('video')).toBeNull();
      // The tile is still openable.
      expect(screen.getByRole('button', { name: /open video/i })).toBeInTheDocument();
    });
```

Update the remote photo filter expectation: the gallery currently keeps remote
rows only when `!!m.url`. The new code must keep a remote photo when it has any
usable URL. No separate test needed beyond the fixture change above (photo now
has `url:null` but `thumb_url` set, and it must still render).

**Step 3: Run the tests to verify they fail**

Run: `npx vitest run --pool=forks src/components/firstVisit/__tests__/MediaGallery.test.tsx`
Expected: FAIL — remote photo filter drops `url:null` rows; no placeholder for
remote video; img src still points at `url`.

**Step 4: Implement the MediaGallery changes**

In `src/components/firstVisit/MediaGallery.tsx`:

(a) Fix the remote filter (a photo now has `url:null`; keep any row with a
usable URL):

```ts
      const theirs = remote.filter(
        (m) =>
          !localIds.has(m.id) &&
          !!(m.thumb_url || m.view_url || m.url) &&
          m.target_id === targetId &&
          m.area_key === areaKey &&
          (questionKey ? m.question_key === questionKey : true),
      );
```

(b) Rebuild the unified `items` list to carry both a tile URL and a separate
modal URL, plus a `remote` flag:

```ts
  const items = [
    ...rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      tileUrl: urls[r.id],
      viewUrl: urls[r.id],
      uploaded: !!r.uploaded_at,
      deletable: true,
      remote: false,
    })),
    ...remoteRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      // Photos: small thumbnail in the tile. Video/audio: no tile media.
      tileUrl: r.kind === 'photo' ? (r.thumb_url ?? r.view_url ?? undefined) : undefined,
      // Modal: fit-to-screen photo, or the streamed video/audio URL.
      viewUrl: r.kind === 'photo' ? (r.view_url ?? r.thumb_url ?? undefined) : (r.url ?? undefined),
      uploaded: true,
      deletable: false,
      remote: true,
    })),
  ];
```

(c) In the tile render, use `row.tileUrl`, add lazy/async decode on images, and
render a placeholder when there's no tile media (remote video/audio):

```ts
                {row.tileUrl == null ? (
                  // Remote video/audio: no eager media element — a film/clip
                  // placeholder that loads the real file only in the modal.
                  <div className="flex h-full w-full items-center justify-center text-gray-400">
                    <span aria-hidden className="text-xl">
                      {row.kind === 'audio' ? '🎧' : '🎬'}
                    </span>
                  </div>
                ) : row.kind === 'video' ? (
                  <video
                    src={row.tileUrl}
                    muted
                    preload="metadata"
                    className="h-full w-full object-cover"
                    aria-label={`${row.kind} thumbnail`}
                  />
                ) : (
                  <img
                    src={row.tileUrl}
                    alt={`${row.kind} thumbnail`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                )}
```

Keep the button's `aria-label={`Open ${row.kind}`}` so `/open video/i` matches.

(d) In the modal, use `openRow.viewUrl` and add `preload="none"` to video:

```ts
            {openRow.kind === 'video' ? (
              <video
                src={openRow.viewUrl}
                controls
                autoPlay
                preload="none"
                className="max-h-[80vh] max-w-full rounded"
                aria-label={`${openRow.kind} preview`}
              />
            ) : (
              <img
                src={openRow.viewUrl}
                alt={`${openRow.kind} preview`}
                className="max-h-[80vh] max-w-full rounded"
              />
            )}
```

Note: `openRow` is derived from `items`, so it now has `viewUrl`. Update the
`openRow` lookup type if TypeScript needs it (it infers from `items`).

**Step 5: Run the tests**

Run: `npx vitest run --pool=forks src/components/firstVisit/__tests__/MediaGallery.test.tsx`
Expected: PASS. The existing "renders one thumbnail per row" test (local photo +
local video) still passes because local video keeps its `<video>` tile and local
photo keeps an `<img>`.

**Step 6: Commit**

```bash
git add src/components/firstVisit/MediaGallery.tsx src/components/firstVisit/__tests__/MediaGallery.test.tsx
git commit -m "feat(fv): gallery shows remote thumbnails + tap-to-load; fixes mobile OOM

Remote photos render a ~200px thumb in the tile and load the ~1080px view only
in the tap-open modal; remote videos render a placeholder and stream (preload
none) only when opened. Local images get loading=lazy/decoding=async."
```

---

## Task 4: Full verification

**Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Vitest does not typecheck test files, so this is the gate
that catches `thumb_url`/`view_url`/`viewUrl`/`tileUrl` type mismatches.)

**Step 2: Run the full test suite (single run, forks pool)**

Run: `npx vitest run --pool=forks`
Expected: all tests pass (baseline was 459 tests + tsc clean per project memory;
new/changed tests included).

**Step 3: Manual verification against a real transformed URL**

Confirm the transform endpoint still returns a small image (sanity that the
route's URLs will work in the field). From the repo root:

```bash
KEY=$(grep '^HUB_SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2- | tr -d '"')
BASE="https://ivdzzvkwrrrhlwqlgdcs.supabase.co"
SP="70208a61-2119-4183-bd55-9300b7ff4b34/2a46a719-3238-43b1-b009-26cbd5e43fd7.jpg"
T=$(curl -s -X POST -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"expiresIn":3600,"transform":{"width":200,"height":200,"resize":"contain"}}' \
  "$BASE/storage/v1/object/sign/first-visit-photos/$SP" | python3 -c "import sys,json;print(json.load(sys.stdin)['signedURL'])")
curl -s -o /dev/null -w "thumb http=%{http_code} bytes=%{size_download}\n" "$BASE/storage/v1$T"
```

Expected: `http=200` and bytes in the single-KB range (≈6 KB), not megabytes.

**Step 4: Post-deploy field check (manual, after merge auto-deploys)**

On a mobile device (or DevTools device emulation + Network throttling), open
Abhi's inspection's unit with media and confirm: the phase renders thumbnails,
the tab does NOT crash, tapping a photo enlarges it, tapping a video streams it.
The client `getRemoteMedia` cache expires after 10 min, so a reopen post-deploy
picks up the new URLs.

---

## Task 5: Ship + record

**Step 1: Push and update PR #29**

```bash
git push
```

The branch is `feat/fv-cloud-restore` (PR #29). Add a PR comment summarizing the
OOM fix (root cause: full-res remote media decode; fix: transform thumbnails +
tap-to-load). Merging auto-deploys to prod (project `inspection-app-y517`).

**Step 2: Update project memory**

Update `MEMORY.md` current-state + the 2026-07-09 incident note: cross-device
media OOM (Chrome renderer crash on opening a media-heavy unit) fixed via
thumb_url/view_url transforms + tap-to-load video. Note the accepted follow-up:
LOCAL blobs are still rendered full-res (lazy/async only) — a device that
captured many photos could OOM the same way; add client-side downscaling if it's
ever observed.

---

## Out of scope (do NOT build)
- Client-side downscaling / thumbnail cache for LOCAL blobs (YAGNI; not observed).
- Pinch-zoom in the enlarged view (1080px has little to zoom into).
- A separate on-demand full-res download endpoint.
