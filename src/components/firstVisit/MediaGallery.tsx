'use client';
import { useEffect, useState } from 'react';
import { useMediaCapture } from '@/lib/firstVisit/useMediaCapture';
import { localDb, type LocalMedia } from '@/lib/firstVisit/db';

// View / delete uploads for one (inspection, target, area, question?) tuple.
// This is the SINGLE SOURCE OF TRUTH for the per-question file count: it loads
// the matching media rows from Dexie, keeps them live via the media-table
// hooks (the project deliberately avoids dexie-react-hooks), lets the inspector
// SEE each file (the core complaint was an un-openable attachment), and DELETE
// the wrong ones.

export function MediaGallery({
  inspectionId,
  targetId,
  areaKey,
  questionKey,
  onCount,
}: {
  inspectionId: string;
  targetId: string;
  areaKey: string;
  questionKey?: string;
  // Fires with the live row count whenever the rendered rows change. This makes
  // MediaGallery the single source of truth for the per-question file count so a
  // parent badge (AttachAffordance) can never disagree with what is rendered.
  onCount?: (n: number) => void;
}) {
  const { remove } = useMediaCapture(inspectionId);
  const [rows, setRows] = useState<LocalMedia[]>([]);
  // Bumped by Dexie table hooks so the query re-runs when any sibling
  // component (AttachAffordance, MediaButtons) writes/deletes a media row.
  const [mediaRev, setMediaRev] = useState(0);
  // Object URLs keyed by media id; created in an effect and revoked on cleanup
  // so blobs aren't leaked when rows change or the component unmounts.
  const [urls, setUrls] = useState<Record<string, string>>({});
  // The enlarged view (modal) target, by media id.
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const bump = () => setMediaRev((r) => r + 1);
    localDb.media.hook('creating', bump);
    localDb.media.hook('deleting', bump);
    return () => {
      localDb.media.hook('creating').unsubscribe(bump);
      localDb.media.hook('deleting').unsubscribe(bump);
    };
  }, []);

  // Load the rows for this exact tuple (same filter AttachAffordance uses).
  useEffect(() => {
    let alive = true;
    (async () => {
      const all = await localDb.media
        .where('inspection_id')
        .equals(inspectionId)
        .toArray();
      if (!alive) return;
      const mine = all.filter(
        (m) =>
          m.target_id === targetId &&
          m.area_key === areaKey &&
          (questionKey ? m.question_key === questionKey : true),
      );
      mine.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
      setRows(mine);
    })();
    return () => {
      alive = false;
    };
  }, [inspectionId, targetId, areaKey, questionKey, mediaRev]);

  // Report the live count to any parent badge whenever rows change (initial
  // load, sibling writes via the table hooks, and optimistic deletes).
  useEffect(() => {
    onCount?.(rows.length);
  }, [rows, onCount]);

  // Manage object URLs: build one per row, revoke them when the rows change or
  // the component unmounts.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const row of rows) {
      next[row.id] = URL.createObjectURL(row.blob);
    }
    setUrls(next);
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  }, [rows]);

  const onDelete = async (id: string) => {
    await remove(id);
    // Optimistic: drop it immediately. The deleting-hook refresh re-queries too.
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (openId === id) setOpenId(null);
  };

  if (rows.length === 0) return null;

  const openRow = openId ? rows.find((r) => r.id === openId) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] text-gray-500">
        {rows.length} file{rows.length === 1 ? '' : 's'}
      </p>
      <ul className="flex flex-wrap gap-2 p-0 m-0 list-none">
        {rows.map((row) => {
          const url = urls[row.id];
          return (
            <li key={row.id} className="relative">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setOpenId(row.id)}
                aria-label={`Open ${row.kind}`}
                className="block h-16 w-16 overflow-hidden rounded border border-gray-300 bg-black/5"
              >
                {row.kind === 'video' ? (
                  <video
                    src={url}
                    muted
                    className="h-full w-full object-cover"
                    aria-label={`${row.kind} thumbnail`}
                  />
                ) : (
                  <img
                    src={url}
                    alt={`${row.kind} thumbnail`}
                    className="h-full w-full object-cover"
                  />
                )}
              </button>
              {row.uploaded_at ? (
                <span
                  aria-label="uploaded"
                  title="Uploaded"
                  className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] leading-none text-white shadow"
                >
                  ✓
                </span>
              ) : (
                <span
                  aria-label="uploading"
                  title="Uploading…"
                  className="absolute -left-1.5 -top-1.5 flex h-5 w-5 animate-pulse items-center justify-center rounded-full bg-gray-400 text-[9px] leading-none text-white shadow"
                >
                  ⏳
                </span>
              )}
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onDelete(row.id)}
                aria-label={`Delete ${row.kind}`}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[11px] leading-none text-white shadow hover:bg-red-700"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      {openRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${openRow.kind} preview`}
          onClick={() => setOpenId(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-full max-w-full"
          >
            {openRow.kind === 'video' ? (
              <video
                src={urls[openRow.id]}
                controls
                autoPlay
                className="max-h-[80vh] max-w-full rounded"
                aria-label={`${openRow.kind} preview`}
              />
            ) : (
              <img
                src={urls[openRow.id]}
                alt={`${openRow.kind} preview`}
                className="max-h-[80vh] max-w-full rounded"
              />
            )}
            <button
              type="button"
              onClick={() => setOpenId(null)}
              aria-label="Close preview"
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-900 shadow"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
