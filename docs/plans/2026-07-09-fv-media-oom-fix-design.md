# Fix: cross-device media OOM crash on opening a unit/property

**Date:** 2026-07-09
**Branch:** `feat/fv-cloud-restore` (regression lives here; PR #29 open)
**Status:** Design approved

## Incident

First real field inspector (Abhijeet) opens a visit fine, but pressing into a
property or unit to view answers shows Chrome's crash page:

> Can't open this page. Try: Open in Incognito / Restart Chrome / Restart your device.

That wording is mobile Chrome's **renderer out-of-memory** page — not a network
error (the inspector's paraphrase). The tab's renderer exceeded its memory
budget and was killed.

## Root cause

Regression introduced by `e052599` ("show media captured on other devices via
signed storage URLs"). Chain:

- Before `e052599`, an evicted device (Abhi's, wiped by Slack in-app webview)
  showed **no** media when opening a unit → no memory pressure.
- After it, opening a unit renders **every remote photo/video for that phase as
  a full-resolution `<img>`/`<video>`**. `/api/first-visit/media` signs the
  **original** `storage_path` with no resize.
- MediaGallery shows them as 64px tiles, but **mobile Chrome decodes the full
  source bitmap regardless of CSS size**: a 4000×3000 photo = ~48 MB of
  uncompressed bitmap; videos allocate decoder buffers on top.

Evidence (hub REST, `first_visit_media`): Abhi's inspection `010839f4…` is the
worst case in the whole hub — **18 files / 71 MB / 8 videos**, clustered ~5
files (2 videos) per phase/area. Opening one such phase decodes several full-res
photos **plus** mounts multiple `<video>` elements at once → hundreds of MB →
OOM. Explains: "sudden" (newest deploy), Abhi-specific (most field media), and
picker-is-fine (no media there).

Verified fix precondition: Supabase image transforms ARE enabled on the hub
project. A 200px transform of a real photo returned **6 KB vs 2.68 MB** original
(decoded bitmap ~120 KB vs ~48 MB).

## Design

Goal: opening a unit/property never loads full-resolution media into the page.
Thumbnails are tiny transformed images; full size is loaded one-at-a-time only
in the tap-open modal.

### 1. Media route (`src/app/api/first-visit/media/route.ts`)
For each **photo** row, issue two transformed signed URLs via
`createSignedUrl(path, ttl, { transform })`:
- `thumb_url` — ~200px, `resize: contain` (gallery tile)
- `view_url` — ~1080px, `resize: contain` (modal preview; ~3.5 MB decode, safe)

Stop returning the full original for photos. **Video/audio** keep a plain
signed `url` (batch `createSignedUrls` as today) — no transform exists for them.
A row whose object is missing still degrades to null URLs, never fails the
listing (preserve current behavior).

### 2. `src/lib/firstVisit/remoteMedia.ts`
Extend `RemoteMedia` with `thumb_url: string | null` and
`view_url: string | null`. Keep the 10-min shared cache and the offline →
`[]` fallback.

### 3. `src/components/firstVisit/MediaGallery.tsx`
- Remote **photo** tile → `thumb_url` (fallback `view_url`); modal → `view_url`.
- Remote **video/audio** → lightweight **placeholder tile** (icon), NOT a
  `<video src>`; the real element mounts only in the modal with `preload="none"`.
- Enlarged view is **fit-to-screen** (no pinch-zoom).
- Local blobs (defensive): add `loading="lazy"` + `decoding="async"`. NOT
  client-downscaling local blobs — pre-existing path, phase-paginated, hasn't
  crashed; canvas thumbnailing is YAGNI. Flag as follow-up.

### 4. Testing
- Media-route test: photo rows carry transform-token URLs (`/render/image/sign`
  with `transformations` in the token / transform passed to the client), video
  rows carry a plain signed URL; missing object → null; unauth → 401.
- MediaGallery test: remote photo tile uses `thumb_url`; remote video renders a
  placeholder, not `<video src>`; pressing a photo opens modal with `view_url`;
  pressing a video mounts `<video preload="none">`; error path still `[]`.

### 5. Rollout
App + route only. **No migration, no backfill.** Merge → auto-deploys to prod.
Client media cache expires in 10 min, so Abhi reopens the unit after deploy.

## Decisions / trade-offs
- **`view_url` at ~1080px instead of the original**: keeps the modal safe on a
  constrained device. Cost: no raw full-res zoom in-app — acceptable for a
  field tool. (Confirmed.)
- **Fit-to-screen, no pinch-zoom**: 1080px has little extra detail to zoom into;
  higher-res would reopen the OOM risk. (Confirmed.)
- **Same branch (`feat/fv-cloud-restore`)** rather than a separate hotfix branch
  — regression lives here and PR #29 is still open.

## Follow-ups (out of scope)
- Client-side downscaling / thumbnail cache for LOCAL blobs (a device that
  captured many photos could OOM the same way, though not observed yet).
