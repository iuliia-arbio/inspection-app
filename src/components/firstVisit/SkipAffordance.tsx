'use client';
import { useState } from 'react';
import type { FirstVisitQuestion } from '@/lib/firstVisit/questions';
import { isSkipped, type SkippedValue } from '@/components/firstVisit/ProgressRing';

// Tiny "Mark N/A" affordance for required questions the inspector genuinely
// can't answer (locked door, owner absent, etc.). Stores skipped state as a
// sentinel { __skipped: true, reason } in the answer value so isAnswered()
// treats it as terminal but the hub can distinguish it later.

const COMMON_REASONS = [
  'Owner not present',
  'Area locked / inaccessible',
  'Not applicable to this unit',
  'Visible later in the visit',
];

export function SkipAffordance({
  question,
  value,
  onChange,
}: {
  question: FirstVisitQuestion;
  value: unknown;
  onChange: (next: { value: unknown; wasAcceptedAsIs: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  // Already skipped — the PrefilledField shows the skipped pill + undo, so we
  // render nothing here to avoid duplicating the affordance.
  if (isSkipped(value)) return null;

  // Only meaningful for required questions; optional ones can just be left blank.
  if (!question.required) return null;

  const skip = (r: string) => {
    const trimmed = r.trim();
    const payload: SkippedValue = trimmed ? { __skipped: true, reason: trimmed } : { __skipped: true };
    onChange({ value: payload, wasAcceptedAsIs: false });
    setOpen(false);
    setReason('');
  };

  if (!open) {
    return (
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setOpen(true)}
        className="inline-flex items-center self-start min-h-[44px] text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline"
      >
        Can't answer? Mark as N/A
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border border-gray-200 bg-gray-50 p-2">
      <div className="text-xs font-medium text-gray-700">Why is this N/A?</div>
      <div className="flex flex-wrap gap-1">
        {COMMON_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            tabIndex={-1}
            onClick={() => skip(r)}
            className="rounded-full border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100"
          >
            {r}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Or type your own reason"
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => skip(reason)}
          disabled={!reason.trim()}
          className="rounded-md bg-black px-3 py-1 text-xs text-white disabled:opacity-40"
        >
          Skip
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setOpen(false);
            setReason('');
          }}
          className="text-xs text-gray-400 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
