'use client';
import { useEffect, useState } from 'react';
import { CopyIcon } from '@/components/icons';
import { localDb, type LocalTarget } from '@/lib/firstVisit/db';

// Lets the inspector copy answers from a previously-filled unit onto the
// current unit, scoped to ONE section (phase) at a time — sits next to that
// section's heading rather than once at the top of the whole unit page.
// Copying "all" copies every meaningful answer this phase has on the source
// unit; copying "selected" lets the inspector hand-pick which questions.
// Skips media, hub-suggestion snapshots, and the unit's own label. Hub
// pre-fills on the target are NOT silently overwritten — the copy asks for
// explicit confirm if the target already has any answers in this phase.

type SiblingUnit = LocalTarget & { answerCount: number };
type PhaseQuestion = { slug: string; label: string };

export function CopyFromUnitTrigger({
  inspectionId,
  currentUnitId,
  phaseId,
  phaseQuestions,
  onCopy,
}: {
  inspectionId: string;
  currentUnitId: string;
  phaseId: string;
  phaseQuestions: PhaseQuestion[];
  onCopy: (sourceUnitId: string, questionKeys?: string[]) => Promise<void>;
}) {
  const [step, setStep] = useState<'closed' | 'pick-unit' | 'choose-scope' | 'pick-fields'>(
    'closed',
  );
  const [units, setUnits] = useState<SiblingUnit[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<SiblingUnit | null>(null);
  const [availableFields, setAvailableFields] = useState<PhaseQuestion[]>([]);
  const [checkedSlugs, setCheckedSlugs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step !== 'pick-unit') return;
    (async () => {
      const allUnits = await localDb.targets
        .where('inspection_id')
        .equals(inspectionId)
        .toArray();
      const otherUnits = allUnits.filter((t) => t.kind === 'unit' && t.id !== currentUnitId);
      const enriched = await Promise.all(
        otherUnits.map(async (u) => {
          const rows = await localDb.answers.where('target_id').equals(u.id).toArray();
          const meaningful = rows.filter(
            (a) => a.area_key === phaseId && a.value !== null && a.value !== undefined && a.value !== '',
          ).length;
          return { ...u, answerCount: meaningful };
        }),
      );
      enriched.sort((a, b) => b.answerCount - a.answerCount);
      setUnits(enriched);
    })();
  }, [step, inspectionId, currentUnitId, phaseId]);

  const close = () => {
    setStep('closed');
    setSelectedUnit(null);
    setAvailableFields([]);
    setCheckedSlugs(new Set());
  };

  const pickUnit = async (u: SiblingUnit) => {
    setSelectedUnit(u);
    setStep('choose-scope');
  };

  const startSelectedFields = async () => {
    if (!selectedUnit) return;
    const rows = await localDb.answers.where('target_id').equals(selectedUnit.id).toArray();
    const meaningfulSlugs = new Set(
      rows
        .filter((a) => a.area_key === phaseId && a.value !== null && a.value !== undefined && a.value !== '')
        .map((a) => a.question_key),
    );
    setAvailableFields(phaseQuestions.filter((q) => meaningfulSlugs.has(q.slug)));
    setCheckedSlugs(new Set());
    setStep('pick-fields');
  };

  const toggleField = (slug: string) => {
    setCheckedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const copyAll = async () => {
    if (!selectedUnit) return;
    setBusy(true);
    try {
      await onCopy(selectedUnit.id);
      close();
    } finally {
      setBusy(false);
    }
  };

  const copySelected = async () => {
    if (!selectedUnit || checkedSlugs.size === 0) return;
    setBusy(true);
    try {
      await onCopy(selectedUnit.id, Array.from(checkedSlugs));
      close();
    } finally {
      setBusy(false);
    }
  };

  if (step === 'closed') {
    return (
      <button
        type="button"
        onClick={() => setStep('pick-unit')}
        title="Copy from another unit"
        aria-label="Copy from another unit"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
      >
        <CopyIcon className="h-4 w-4" /> Copy from unit
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        {step === 'pick-unit' && (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Copy this section from…</span>
              <button type="button" onClick={close} className="text-xs text-gray-400 hover:text-gray-700">
                Cancel
              </button>
            </div>
            {units.length === 0 ? (
              <p className="text-xs text-gray-500">No other units in this visit yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {units.map((u) => {
                  const empty = u.answerCount === 0;
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        disabled={empty}
                        onClick={() => pickUnit(u)}
                        className={`flex w-full items-center justify-between gap-2 rounded border bg-white px-3 py-2 text-left text-sm ${
                          empty ? 'border-gray-200 text-gray-400' : 'border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <span className="truncate">{u.label}</span>
                        <span className="text-xs text-gray-500">
                          {empty ? 'empty' : `${u.answerCount} answer${u.answerCount === 1 ? '' : 's'}`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {step === 'choose-scope' && selectedUnit && (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Copy from {selectedUnit.label}</span>
              <button type="button" onClick={close} className="text-xs text-gray-400 hover:text-gray-700">
                Cancel
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={copyAll}
                className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Copy all answers
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={startSelectedFields}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Copy selected answers
              </button>
            </div>
          </>
        )}

        {step === 'pick-fields' && selectedUnit && (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Select answers to copy</span>
              <button
                type="button"
                onClick={() => setStep('choose-scope')}
                className="text-xs text-gray-400 hover:text-gray-700"
              >
                Back
              </button>
            </div>
            {availableFields.length === 0 ? (
              <p className="text-xs text-gray-500">No answers to copy in this section.</p>
            ) : (
              <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                {availableFields.map((q) => (
                  <li key={q.slug}>
                    <label className="flex w-full items-center gap-2 rounded border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={checkedSlugs.has(q.slug)}
                        onChange={() => toggleField(q.slug)}
                      />
                      <span className="truncate">{q.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              disabled={busy || checkedSlugs.size === 0}
              onClick={copySelected}
              className="mt-3 w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Copy {checkedSlugs.size || ''} selected
            </button>
          </>
        )}
      </div>
    </div>
  );
}
