'use client';
import { useRef, useState } from 'react';
import { PlusIcon, FileTextIcon, CameraIcon, VideoIcon, UploadIcon } from '@/components/icons';
import { useMediaCapture } from '@/lib/firstVisit/useMediaCapture';
import { MediaGallery } from './MediaGallery';

// Per-question "+ Attach" affordance: lets the inspector add a free-text note,
// a photo, or a video to any question. None are required. Photo/video reuse
// the same MediaCapture pipeline as type='file' questions. Note writes to the
// existing LocalAnswer.notes column via the parent's onNotesChange callback.

export function AttachAffordance({
  inspectionId,
  targetId,
  areaKey,
  questionKey,
  answerId,
  notes,
  onNotesChange,
  hideMedia = false,
}: {
  inspectionId: string;
  targetId: string;
  areaKey: string;
  questionKey?: string;
  answerId?: string;
  notes?: string;
  onNotesChange: (next: string) => void;
  // Suppresses the photo/video capture buttons and the MediaGallery mount.
  // Set for type='file' questions, which already render their own
  // MediaButtons + MediaGallery — without this, both render, producing a
  // literal duplicate photo/video UI. The note capability stays available.
  hideMedia?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showNote, setShowNote] = useState(false);
  // Count comes from MediaGallery (the single source of truth) via its onCount
  // callback, so the header badge and the gallery's "N file(s)" can't diverge.
  const [mediaCount, setMediaCount] = useState(0);

  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const photoUploadRef = useRef<HTMLInputElement>(null);
  const videoUploadRef = useRef<HTMLInputElement>(null);
  const { persist } = useMediaCapture(inspectionId);

  const onPick = async (kind: 'photo' | 'video', file: File | undefined) => {
    if (!file) return;
    await persist(file, kind, {
      target_id: targetId,
      area_key: areaKey,
      question_key: questionKey,
      answer_id: answerId,
    });
    // No manual increment: the new row triggers MediaGallery's table-hook
    // refresh, which re-fires onCount with the authoritative count.
  };

  const hasNote = (notes ?? '').trim().length > 0;
  const summaryCount = mediaCount + (hasNote ? 1 : 0);

  // Compact state: no note, no media, and the inspector hasn't opened the panel.
  // We still mount MediaGallery (it self-hides when empty) at a STABLE position
  // so it can report its count via onCount; a non-zero count flips `compact`
  // false and expands the card. Keeping the gallery at the same tree position in
  // both states prevents React from unmounting/remounting it (which would reset
  // its rows to [] and re-fire onCount(0), causing a flip-flop).
  const compact = !open && !hasNote && (hideMedia || mediaCount === 0);

  return (
    <div className="mt-1 flex flex-col gap-2">
      {compact ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 self-start rounded-lg px-2 py-2 text-xs font-medium text-gray-500 underline-offset-2 hover:bg-gray-100 hover:text-gray-700 min-h-[44px]"
        >
          <PlusIcon className="h-3.5 w-3.5" /> Attach note, photo, or video
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-gray-200 bg-gray-50 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-700">
              Attachments {summaryCount > 0 && <span className="text-gray-500">· {summaryCount}</span>}
            </span>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setOpen((v) => !v)}
              className="text-[11px] text-gray-400 hover:text-gray-700"
            >
              {open ? 'Collapse' : 'Expand'}
            </button>
          </div>

          {(open || hasNote) && (
            <div className="flex flex-col gap-1">
              {(hasNote || showNote) && (
                <textarea
                  value={notes ?? ''}
                  onChange={(e) => onNotesChange(e.target.value)}
                  placeholder="Note (optional)"
                  rows={2}
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                />
              )}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowNote((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-100"
                >
                  <FileTextIcon className="h-4 w-4" /> {showNote || hasNote ? 'Hide note' : 'Note'}
                </button>
                {!hideMedia && (
                  <>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => photoRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-100"
                    >
                      <CameraIcon className="h-4 w-4" /> Photo
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => videoRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-100"
                    >
                      <VideoIcon className="h-4 w-4" /> Video
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => photoUploadRef.current?.click()}
                      title="Upload photo from device"
                      className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-gray-400 hover:text-gray-700"
                    >
                      <UploadIcon className="h-3.5 w-3.5" /> Upload
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => videoUploadRef.current?.click()}
                      title="Upload video from device"
                      className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-gray-400 hover:text-gray-700"
                    >
                      <UploadIcon className="h-3.5 w-3.5" /> Upload
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stable across compact/expanded so it never unmounts: the single source
          of truth for the count, reported up via onCount. Self-hides when empty.
          Suppressed entirely when hideMedia — the caller (type='file' questions)
          already mounts its own MediaGallery via MediaButtons. */}
      {!hideMedia && (
        <>
          <MediaGallery
            inspectionId={inspectionId}
            targetId={targetId}
            areaKey={areaKey}
            questionKey={questionKey}
            onCount={setMediaCount}
          />

          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => onPick('photo', e.target.files?.[0])}
          />
          <input
            ref={videoRef}
            type="file"
            accept="video/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => onPick('video', e.target.files?.[0])}
          />
          <input
            ref={photoUploadRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => onPick('photo', e.target.files?.[0])}
          />
          <input
            ref={videoUploadRef}
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => onPick('video', e.target.files?.[0])}
          />
        </>
      )}
    </div>
  );
}
