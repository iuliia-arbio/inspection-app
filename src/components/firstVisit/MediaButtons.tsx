'use client';
import { type ReactNode, useRef } from 'react';
import { CameraIcon, VideoIcon, UploadIcon } from '@/components/icons';
import { useMediaCapture } from '@/lib/firstVisit/useMediaCapture';
import { MediaGallery } from './MediaGallery';

type MediaKind = 'photo' | 'video';

export function MediaButtons({
  inspectionId,
  targetId,
  areaKey,
  questionKey,
  answerId,
  kinds = ['photo', 'video'],
  label,
  description,
  required,
}: {
  inspectionId: string;
  targetId: string;
  areaKey: string;
  questionKey?: string;
  answerId?: string;
  // Which capture surfaces to expose. FV-survey file-typed questions don't
  // yet split photo vs video so we default to both.
  kinds?: MediaKind[];
  label?: string;
  description?: string | null;
  required?: boolean;
}) {
  const { persist } = useMediaCapture(inspectionId);

  const onPick = async (kind: MediaKind, file: File | undefined) => {
    if (!file) return;
    await persist(file, kind, {
      target_id: targetId,
      area_key: areaKey,
      question_key: questionKey,
      answer_id: answerId,
    });
  };

  if (kinds.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 p-2">
      {label && (
        <span className="text-sm font-medium">
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </span>
      )}
      {description && <p className="text-xs text-gray-500">{description}</p>}
      <div className="flex flex-col gap-1.5">
        {kinds.map((kind) => (
          <MediaRow key={kind} kind={kind} onPick={(f) => onPick(kind, f)} />
        ))}
      </div>
      <MediaGallery
        inspectionId={inspectionId}
        targetId={targetId}
        areaKey={areaKey}
        questionKey={questionKey}
      />
    </div>
  );
}

function MediaRow({
  kind,
  onPick,
}: {
  kind: MediaKind;
  onPick: (file: File | undefined) => void;
}) {
  const captureRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const accept = kind === 'photo' ? 'image/*' : 'video/*';
  const captureLabel: ReactNode = kind === 'photo' ? <><CameraIcon className="h-4 w-4" /> Take photo</> : <><VideoIcon className="h-4 w-4" /> Record video</>;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        tabIndex={-1}
        onClick={() => captureRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
      >
        {captureLabel}
      </button>

      <button
        type="button"
        tabIndex={-1}
        onClick={() => uploadRef.current?.click()}
        title={`Upload ${kind} from device`}
        aria-label={`Upload ${kind} from device`}
        className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-gray-400 hover:text-gray-700"
      >
        <UploadIcon className="h-4 w-4" /> Upload
      </button>

      <input
        ref={captureRef}
        type="file"
        accept={accept}
        capture="environment"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      <input
        ref={uploadRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
    </div>
  );
}
