'use client';
import { MicIcon, AlertTriangleIcon } from '@/components/icons';

export type DictationStatus = 'idle' | 'recording' | 'transcribing' | 'error';

export type VoiceDictationButtonProps = {
  status: DictationStatus;
  online: boolean;
  elapsedMs: number;
  onStart: () => void;
  onStop: () => void;
  // Optional: disable the idle mic even when online (e.g. another mic in this
  // section is already recording). Additive — defaults to enabled.
  disabled?: boolean;
  // Optional: label shown during the transcribing/processing state. The
  // section-voice flow shows "Thinking…" (transcribe + extract); defaults to
  // "Transcribing…" for per-field dictation.
  transcribingLabel?: string;
};

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VoiceDictationButton({
  status,
  online,
  elapsedMs,
  onStart,
  onStop,
  disabled = false,
  transcribingLabel = 'Transcribing…',
}: VoiceDictationButtonProps) {
  if (status === 'transcribing') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1 text-xs text-gray-500"
      >
        <span className="h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-gray-600" />
        {transcribingLabel}
      </span>
    );
  }

  if (status === 'recording') {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1 text-xs font-medium text-red-600"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
          <span className="tabular-nums">{fmt(elapsedMs)}</span>
        </span>
        <button
          type="button"
          onClick={onStop}
          className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
        >
          Stop
        </button>
      </span>
    );
  }

  if (status === 'error') {
    // Transcription failed. Surface it visibly + announce it, and let the same
    // button restart a recording (retry) so an error never blocks the field.
    return (
      <span
        role="status"
        aria-live="assertive"
        className="inline-flex items-center gap-1 text-xs font-medium text-red-600"
      >
        <button
          type="button"
          aria-label="Transcription failed — tap to retry"
          disabled={!online}
          onClick={onStart}
          className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true" className="inline-flex items-center gap-0.5"><AlertTriangleIcon className="h-4 w-4" /><MicIcon className="h-4 w-4" /></span>
          <span>Transcription failed — tap to retry</span>
        </button>
      </span>
    );
  }

  // idle
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label="Record voice note"
        disabled={!online || disabled}
        onClick={onStart}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <MicIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      {!online && (
        <span className="text-[10px] text-gray-400">Voice needs a connection — type for now</span>
      )}
    </span>
  );
}
