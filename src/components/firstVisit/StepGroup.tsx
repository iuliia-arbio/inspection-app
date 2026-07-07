'use client';
import { useMemo, useState } from 'react';
import type { FirstVisitQuestion } from '@/lib/firstVisit/questions';
import type { LocalAnswer } from '@/lib/firstVisit/db';
import { PrefilledField } from '@/components/firstVisit/PrefilledField';
import { MediaButtons } from '@/components/firstVisit/MediaButtons';
import { SkipAffordance } from '@/components/firstVisit/SkipAffordance';
import { AttachAffordance } from '@/components/firstVisit/AttachAffordance';
import { MultiSelectChips } from '@/components/firstVisit/MultiSelectChips';
import { ConditionalFollowUp } from '@/components/firstVisit/ConditionalFollowUp';
import { PerOptionFollowUp } from '@/components/firstVisit/PerOptionFollowUp';
import { followUpKey, perOptionFollowUpKey } from '@/lib/firstVisit/multiSelect';
import { isSkipped, type SkippedValue } from '@/components/firstVisit/ProgressRing';
import { maxStepIndexForGroup, snapshotConfidence } from '@/lib/firstVisit/aiFill';

// Soft-delete sentinel value used when the inspector removes a block. We
// don't have a hard-delete API and a missing step_index would cause sibling
// blocks to renumber, so we write `null` value + a marker reason on every
// question in that block instead. The progress predicate already treats null
// as unanswered, and the marker survives a round-trip through Dexie/the API.
const REMOVED_SKIPPED: SkippedValue = { __skipped: true, reason: '__removed' };

// Answers map key for a single question (single-instance) or a question
// instance within a step (repeater block). Mirrors the keying in UnitSurvey.
function answerKey(
  targetId: string,
  areaKey: string,
  slug: string,
  stepIndex: number | null,
): string {
  if (stepIndex == null) return `${targetId}::${areaKey}::${slug}`;
  return `${targetId}::${areaKey}::${slug}::${stepIndex}`;
}

export type StepGroupProps = {
  groupId: string;
  groupLabel?: string;
  // Optional one-line description rendered under the group title to explain
  // what the block collects. Sourced from repeaterGroupMeta at the call site.
  intro?: string;
  // Noun used to label each block ("Finding 1", "Step 1", ...). Defaults to
  // 'Step' for back-compat with the previous hardcoded behaviour.
  itemNoun?: string;
  questions: FirstVisitQuestion[];
  inspectionId: string;
  targetId: string;
  areaKey: string;
  hubValueLookup: (slug: string, stepIndex: number | null) => unknown | undefined;
  justFilledLookup?: (slug: string, stepIndex: number | null) => boolean;
  answers: Record<string, LocalAnswer>;
  onChange: (
    q: FirstVisitQuestion,
    next: { value: unknown; wasAcceptedAsIs: boolean },
    stepIndex: number | null,
    syntheticKey?: string,
  ) => Promise<void> | void;
  setNotes: (q: FirstVisitQuestion, nextNotes: string, stepIndex: number | null) => void;
};

// Block-repeater container. Renders the group's questions inside one or more
// "Step / Block N" cards, with an "+ Add step" button below and a "×" remove
// button (confirm-modal) per block. Tracks step_indices observed in the
// answers map; new blocks have step_index = max(existing) + 1.
export function StepGroup({
  groupId,
  groupLabel,
  intro,
  itemNoun = 'Step',
  questions,
  inspectionId,
  targetId,
  areaKey,
  hubValueLookup,
  justFilledLookup,
  answers,
  onChange,
  setNotes,
}: StepGroupProps) {
  // Derive blocks from the answers map by scanning all keys that match any of
  // the group's slugs for this target+area. Always include step_index 0 so
  // there is one empty block on initial render. Locally-pending blocks (added
  // via "+ Add step" but not yet written) live in `pendingExtra`.
  const [pendingExtra, setPendingExtra] = useState<number[]>([]);

  const blocks = useMemo(() => {
    const seen = new Set<number>();
    const slugSet = new Set(questions.map((q) => q.slug));
    let hasAnswer = false;
    for (const a of Object.values(answers)) {
      if (a.target_id !== targetId) continue;
      if (a.area_key !== areaKey) continue;
      if (!slugSet.has(a.question_key)) continue;
      const removed =
        a.value &&
        typeof a.value === 'object' &&
        (a.value as { reason?: string }).reason === '__removed';
      if (removed) continue;
      const idx = a.step_index;
      if (idx == null) continue;
      seen.add(idx);
      hasAnswer = true;
    }
    // Always keep the first block visible (step_index 0). New blocks added via
    // "+ Add step" land in pendingExtra; without this we'd hide the empty
    // initial block as soon as the user clicks "Add" before typing anything.
    if (!hasAnswer) seen.add(0);
    for (const idx of pendingExtra) seen.add(idx);
    return Array.from(seen).sort((a, b) => a - b);
  }, [answers, questions, targetId, areaKey, pendingExtra]);

  const addBlock = () => {
    // Allocate past ALL existing step indices for the group — including
    // soft-removed (tombstoned) blocks, which `blocks` excludes but whose
    // answer rows (and media, keyed `slug::idx`) still occupy their index.
    // Reusing a tombstoned index would render the new block's questions as
    // removed and resurrect the old block's media. Mirrors the append
    // semantics of maxStepIndexForGroup in aiFill (voice-fill).
    const maxOccupied = maxStepIndexForGroup(
      answers,
      questions.map((q) => q.slug),
      targetId,
      areaKey,
    );
    const maxVisible = blocks.length === 0 ? -1 : Math.max(...blocks);
    const next = Math.max(maxOccupied, maxVisible) + 1;
    setPendingExtra((p) => [...p, next]);
  };

  const removeBlock = async (idx: number) => {
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('Remove block? Its values will be cleared.')
        : true;
    if (!ok) return;
    // Drop from pending if it was never written.
    setPendingExtra((p) => p.filter((v) => v !== idx));
    // Soft-delete every answered question in this step.
    for (const q of questions) {
      const k = answerKey(targetId, areaKey, q.slug, idx);
      if (answers[k]) {
        await onChange(q, { value: REMOVED_SKIPPED, wasAcceptedAsIs: false }, idx);
      }
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {(groupLabel || intro) && (
        <div className="flex flex-col gap-0.5">
          {groupLabel && (
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {groupLabel}
            </div>
          )}
          {intro && <p className="text-xs text-gray-500">{intro}</p>}
        </div>
      )}
      {blocks.map((idx, displayIdx) => (
        <BlockCard
          key={`${groupId}-${idx}`}
          title={`${itemNoun} ${displayIdx + 1}`}
          showRemove={blocks.length > 1}
          onRemove={() => removeBlock(idx)}
        >
          {questions.map((q) => {
            const k = answerKey(targetId, areaKey, q.slug, idx);
            const answer = answers[k];
            const value = answer?.value;

            // Skip rendering rows whose value is the soft-delete marker — they
            // shouldn't even appear inside a block that survived removal.
            if (isSkipped(value) && (value as SkippedValue).reason === '__removed') {
              return null;
            }

            return (
              <QuestionRow
                key={q.slug}
                question={q}
                inspectionId={inspectionId}
                targetId={targetId}
                areaKey={areaKey}
                stepIndex={idx}
                hubValue={hubValueLookup(q.slug, idx)}
                justFilled={justFilledLookup?.(q.slug, idx) ?? false}
                answers={answers}
                onChange={onChange}
                setNotes={setNotes}
              />
            );
          })}
        </BlockCard>
      ))}
      <button
        type="button"
        tabIndex={-1}
        onClick={addBlock}
        className="self-start rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
      >
        + Add step
      </button>
    </div>
  );
}

function BlockCard({
  title,
  showRemove,
  onRemove,
  children,
}: {
  title: string;
  showRemove: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="relative rounded-lg border border-gray-200 p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {showRemove && (
          <button
            type="button"
            tabIndex={-1}
            onClick={onRemove}
            aria-label={`Remove ${title}`}
            className="rounded-full px-2 py-0.5 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-red-500"
          >
            ×
          </button>
        )}
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

// Shared question row used by StepGroup blocks AND by the flat (non-grouped)
// renderer in UnitSurvey. Renders the picker/input, then any conditional
// follow-up and per-option follow-up tied to it.
export function QuestionRow({
  question,
  inspectionId,
  targetId,
  areaKey,
  stepIndex,
  hubValue,
  justFilled,
  answers,
  onChange,
  setNotes,
}: {
  question: FirstVisitQuestion;
  inspectionId: string;
  targetId: string;
  areaKey: string;
  stepIndex: number | null;
  hubValue: unknown | undefined;
  justFilled?: boolean;
  answers: Record<string, LocalAnswer>;
  onChange: (
    q: FirstVisitQuestion,
    next: { value: unknown; wasAcceptedAsIs: boolean },
    stepIndex: number | null,
    syntheticKey?: string,
  ) => Promise<void> | void;
  setNotes: (q: FirstVisitQuestion, nextNotes: string, stepIndex: number | null) => void;
}) {
  const k = answerKey(targetId, areaKey, question.slug, stepIndex);
  const answer = answers[k];
  const value = answer?.value;

  const followUpAnswer =
    answers[answerKey(targetId, areaKey, followUpKey(question.slug), stepIndex)];

  const isMulti = !!question.multi_select;
  const selectedOptions: string[] = isMulti && Array.isArray(value) ? (value as string[]) : [];
  // Multi-select prefill: hub/voice suggestions for chip fields arrive as an
  // array. PrefilledField (which owns the scalar Accept banner) is bypassed for
  // multi-selects, so render a matching Accept affordance here — otherwise pill
  // suggestions are written but never shown. Hide once the inspector has a
  // selection (accepted or chosen), mirroring the scalar banner.
  const multiSuggestion: string[] = isMulti && Array.isArray(hubValue)
    ? (hubValue as unknown[]).filter((v): v is string => typeof v === 'string' && v !== '')
    : [];
  const showMultiSuggestion = multiSuggestion.length > 0 && selectedOptions.length === 0;

  return (
    <div className="flex flex-col gap-1">
      {isMulti ? (
        <div className="flex flex-col gap-2 p-2">
          <label className="text-sm font-medium">
            {question.label}
            {question.required && <span className="ml-1 text-red-500">*</span>}
          </label>
          {question.description && (
            <p className="text-xs text-gray-500">{question.description}</p>
          )}
          {showMultiSuggestion && (
            <div
              className={`flex items-center gap-2 rounded-md bg-indigo-50 px-3 py-2 text-sm ${
                justFilled ? 'ring-2 ring-indigo-300' : ''
              }`}
            >
              <span className="rounded bg-indigo-200 px-1.5 py-0.5 text-xs font-medium text-indigo-900">
                {justFilled ? '✦ from voice' : 'Pre-filled'}
              </span>
              <span className="truncate text-indigo-900">{multiSuggestion.join(', ')}</span>
              <button
                type="button"
                tabIndex={-1}
                className="ml-auto rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 active:bg-indigo-800"
                onClick={() =>
                  onChange(question, { value: multiSuggestion, wasAcceptedAsIs: true }, stepIndex)
                }
              >
                Accept
              </button>
            </div>
          )}
          <MultiSelectChips
            id={`q-${question.slug}${stepIndex == null ? '' : `-${stepIndex}`}`}
            question={question}
            value={selectedOptions}
            onChange={(next) =>
              onChange(question, { value: next, wasAcceptedAsIs: false }, stepIndex)
            }
          />
          {question.per_option_follow_up && (
            <PerOptionFollowUp
              question={question}
              selectedOptions={selectedOptions}
              perOptionValues={Object.fromEntries(
                selectedOptions.map((opt) => {
                  const synthKey = perOptionFollowUpKey(question.slug, opt);
                  const stored = answers[answerKey(targetId, areaKey, synthKey, null)];
                  return [opt, stored?.value == null ? '' : String(stored.value)];
                }),
              )}
              onPerOptionChange={(opt, next) =>
                onChange(
                  question,
                  { value: next, wasAcceptedAsIs: false },
                  null,
                  perOptionFollowUpKey(question.slug, opt),
                )
              }
            />
          )}
        </div>
      ) : question.type === 'file' ? (
        // Media capture inside a repeater block. PrefilledField has no 'file'
        // branch (it would render a bare label), so we render MediaButtons here
        // the same way the flat renderer in UnitSurvey does. The step index is
        // folded into the question_key so each finding step's photos/videos are
        // stored under a distinct key and don't collide across blocks.
        <MediaButtons
          inspectionId={inspectionId}
          targetId={targetId}
          areaKey={areaKey}
          questionKey={stepIndex == null ? question.slug : `${question.slug}::${stepIndex}`}
          answerId={answer?.id}
          label={question.label}
          description={question.description}
          required={question.required}
        />
      ) : (
        <PrefilledField
          question={question}
          hubValue={hubValue}
          value={value ?? ''}
          suggestionConfidence={snapshotConfidence(answer?.hub_suggestion_snapshot)}
          justFilled={justFilled}
          onChange={(c) => onChange(question, c, stepIndex)}
        />
      )}

      <ConditionalFollowUp
        question={question}
        parentValue={value}
        followUpValue={followUpAnswer?.value}
        onFollowUpChange={(next) =>
          onChange(
            question,
            { value: next, wasAcceptedAsIs: false },
            stepIndex,
            followUpKey(question.slug),
          )
        }
      />

      {!isMulti && question.type !== 'file' && (
        <SkipAffordance
          question={question}
          value={value}
          onChange={(c) => onChange(question, c, stepIndex)}
        />
      )}

      <AttachAffordance
        inspectionId={inspectionId}
        targetId={targetId}
        areaKey={areaKey}
        questionKey={question.slug}
        answerId={answer?.id}
        notes={answer?.notes}
        onNotesChange={(n) => setNotes(question, n, stepIndex)}
      />
    </div>
  );
}
