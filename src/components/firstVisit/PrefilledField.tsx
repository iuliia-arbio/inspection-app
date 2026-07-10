'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FirstVisitQuestion } from '@/lib/firstVisit/questions';
import { isSkipped, type SkippedValue } from '@/components/firstVisit/ProgressRing';
import { VoiceDictationButton, type DictationStatus } from '@/components/firstVisit/VoiceDictationButton';
import { useVoiceDictation } from '@/lib/firstVisit/useVoiceDictation';
import { appendDictation } from '@/lib/firstVisit/appendDictation';
import { ScaleField } from '@/components/firstVisit/ScaleField';

export type PrefilledFieldProps = {
  question: FirstVisitQuestion;
  hubValue: unknown | undefined;
  value: unknown;
  onChange: (next: { value: unknown; wasAcceptedAsIs: boolean }) => void;
  // When the pre-filled value came from a low-confidence AI voice extraction,
  // the banner gets an amber "check this" cue. Additive; undefined = no cue
  // (hub prefills and confident AI fills look the same as before).
  suggestionConfidence?: number | null;
  // Transiently true right after a voice fill lands, so the banner animates in
  // with a "from voice" tag. Additive; defaults false.
  justFilled?: boolean;
  // Missing-required cue (Batch E1). Computed UPSTREAM (UnitSurvey) as
  // required && currently visible && not answered — this component only
  // renders the state. 'subtle' = calm amber left border while the inspector
  // works; 'strong' = red border + aria-invalid after a submit attempt.
  // Never blocks input; undefined = no cue.
  missing?: 'subtle' | 'strong';
};

// Below this, an AI-suggested value is flagged for closer review.
const LOW_CONF_THRESHOLD = 0.6;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Caret-stable text editing. A naively-controlled input (value={value}) resets
// the caret to start/end on mid-string edits: each keystroke round-trips through
// async autosave/parent state, and when the lagging value echoes back React
// rewrites the DOM value via its internal value tracker, which moves the caret.
//
// Fix: make the element UNCONTROLLED (defaultValue, the DOM owns the text while
// the user types) and only write the prop value back IMPERATIVELY when it
// changes from an EXTERNAL source — voice-append, Accept-prefilled, skip/undo,
// or the branching clear-on-hide.
//
// Distinguishing external writes from the user's own keystroke echoes by
// value-comparison alone is NOT enough under fast typing: each keystroke
// round-trips through async autosave, so when a user types "a" then "b" before
// the first echo returns, the STALE echo "a" arrives while the DOM already
// shows "ab". That stale "a" equals neither the latest emit ("ab") nor the DOM
// ("ab"), so a naive guard would write it — visibly reverting the text and
// jumping the caret until the next echo restores it.
//
// The clean rule keys off FOCUS instead: while the element is focused, the user
// is actively typing and the DOM is authoritative — EVERY incoming value is an
// echo of their own edit stream (current or stale), so we never write it. Only
// when the element is NOT focused do we adopt external values. This is correct
// for every external source in this app because they all blur the input first:
// voice (tapping the mic button), Accept (tabIndex=-1 button), skip/undo
// buttons, date-autofill (programmatic, on mount), and clear-on-hide
// (programmatic). If a genuine external write could ever land while the field
// is focused, this would need superseded-emit tracking instead — but none can.
//
// Returns a ref to attach to the element, the initial defaultValue, and an
// onChange that forwards the live DOM value upward without re-controlling it.
function useEchoInput(
  value: string,
  emit: (next: string) => void,
  // Fires after an EXTERNAL value is written into the DOM (e.g. so a textarea
  // can re-run its auto-grow). Not called for the user's own keystroke echoes.
  onExternalSync?: () => void,
): {
  ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  defaultValue: string;
  onChange: (next: string) => void;
} {
  const elRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  // Initial value captured once for defaultValue — the DOM owns it afterward.
  // useState (not a ref) so we can read it during render without lint noise.
  const [initialValue] = useState(value);
  // Last value we emitted upward; seeded so the first render isn't "external".
  const lastEmittedRef = useRef(value);
  const onExternalSyncRef = useRef(onExternalSync);
  // Keep the callback ref current without mutating during render (react-hooks/refs).
  // No dep array → runs after every commit, always tracking the latest callback.
  useEffect(() => {
    onExternalSyncRef.current = onExternalSync;
  });

  const ref = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      elRef.current = el;
    },
    [],
  );

  // Sync EXTERNAL prop changes into the DOM imperatively, after commit.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    // While focused, the user is typing: the DOM is authoritative and every
    // incoming value is an echo of their own edit stream (possibly a STALE one
    // under fast typing). Never write into a focused field — that prevents the
    // stale-echo clobber that would revert text and jump the caret.
    if (document.activeElement === el) {
      lastEmittedRef.current = value;
      return;
    }
    if (value === el.value) return; // already displayed (idempotent)
    el.value = value; // not focused → genuine external source, adopt it
    lastEmittedRef.current = value;
    onExternalSyncRef.current?.();
  }, [value]);

  const onChange = useCallback(
    (next: string) => {
      lastEmittedRef.current = next;
      emit(next);
    },
    [emit],
  );

  return { ref, defaultValue: initialValue, onChange };
}

// How long the "✓ Saved" pill stays visible before fading out.
const SAVED_VISIBLE_MS = 1200;
// Debounce delay for text/textarea inputs so the pulse only fires after the
// inspector pauses typing — typing every keystroke would be noisy.
const TEXT_DEBOUNCE_MS = 600;

export function PrefilledField({ question, hubValue, value, onChange, suggestionConfidence, justFilled, missing }: PrefilledFieldProps) {
  const hasHub = hubValue !== undefined && hubValue !== null && hubValue !== '';
  // Once the field has a value (the inspector Accepted the suggestion or typed
  // their own), the "Pre-filled / Accept" banner has done its job and should
  // disappear — leaving just the answered field.
  const hasValue = value !== undefined && value !== null && value !== '';
  const lowConfidence =
    typeof suggestionConfidence === 'number' && suggestionConfidence < LOW_CONF_THRESHOLD;
  const id = `q-${question.slug}`;
  // 'observe' mode is freeform observational — render as textarea for text fields.
  const isLongText = question.type === 'text' && question.mode === 'observe';
  const skipped = isSkipped(value);

  // Tiny confirmation pulse — shows next to the field after a value persists so
  // the inspector gets a trust signal that their input didn't vanish.
  const [showSaved, setShowSaved] = useState(false);
  // Mirror the mic's transcribing state up so the text field can lock during the
  // round-trip, preventing a mid-flight edit race with the appended dictation.
  const [dictationStatus, setDictationStatus] = useState<DictationStatus>('idle');
  const isTranscribing = dictationStatus === 'transcribing';
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (hideRef.current) {
      clearTimeout(hideRef.current);
      hideRef.current = null;
    }
  }, []);

  const triggerSaved = useCallback(() => {
    if (hideRef.current) clearTimeout(hideRef.current);
    setShowSaved(true);
    hideRef.current = setTimeout(() => setShowSaved(false), SAVED_VISIBLE_MS);
  }, []);

  const pulseImmediate = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    triggerSaved();
  }, [triggerSaved]);

  const pulseDebounced = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      triggerSaved();
    }, TEXT_DEBOUNCE_MS);
  }, [triggerSaved]);

  useEffect(() => clearTimers, [clearTimers]);

  // Text + textarea use a local echo buffer to keep the caret stable on
  // mid-string edits (see useEchoInput). Only these two branches need it; the
  // number/date/select/boolean/scale branches have no mid-string caret problem.
  // Shared keystroke handler for the single-line input and the textarea: forward
  // the value up and pulse the debounced "saved" confirmation.
  const emitText = useCallback(
    (next: string) => {
      onChange({ value: next, wasAcceptedAsIs: false });
      pulseDebounced();
    },
    [onChange, pulseDebounced],
  );
  const valueStr = value == null ? '' : String(value);
  // Single-line input gets a caret-stable echo handle here. The textarea owns
  // its own useEchoInput internally (it also needs resize on external sync).
  const textInput = useEchoInput(valueStr, emitText);

  // Auto-fill date fields with today's date once on mount, so the inspector
  // confirms by leaving it rather than typing it. They can clear or change it.
  const didAutofillDate = useRef(false);
  useEffect(() => {
    if (didAutofillDate.current) return;
    if (question.type !== 'date') return;
    if (value !== null && value !== undefined && value !== '') return;
    didAutofillDate.current = true;
    onChange({ value: todayIso(), wasAcceptedAsIs: false });
    // mount-only: we only want the today default to fire on first display per
    // PrefilledField lifecycle, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skipped questions render in a collapsed read-only state with one-tap undo.
  if (skipped) {
    const sv = value as SkippedValue;
    return (
      <div className="flex flex-col gap-1 rounded-md bg-gray-50 p-3">
        <div className="flex items-start gap-2">
          <span className="text-sm font-medium text-gray-700 line-through">
            {question.label}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-gray-600">
            <span className="rounded bg-gray-200 px-1.5 py-0.5 font-medium uppercase tracking-wide">
              N/A
            </span>
            {sv.reason && <span className="ml-2 italic">{sv.reason}</span>}
          </span>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onChange({ value: null, wasAcceptedAsIs: false })}
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-white"
          >
            Undo
          </button>
        </div>
      </div>
    );
  }

  // Missing-required styling: an amber left border keeps the live cue calm;
  // after a submit attempt the border turns red and the concrete inputs gain
  // aria-invalid + a red outline. Purely visual — input is never blocked.
  const missingStrong = missing === 'strong';
  const missingCls =
    missing === 'subtle'
      ? 'border-l-2 border-amber-300'
      : missingStrong
        ? 'border-l-2 border-red-500'
        : '';
  const inputBorderCls = missingStrong ? 'border-red-500' : 'border-gray-300';

  return (
    <div className={`relative flex flex-col gap-1 p-2 ${missingCls}`} data-missing={missing}>
      {/* Saved confirmation pulse — small, emerald, fades out. Lives inside the
          main field container so the skipped early-return never renders it. */}
      <span
        aria-live="polite"
        aria-hidden={!showSaved}
        className={`pointer-events-none absolute right-2 top-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-emerald-700 transition-opacity duration-300 ${
          showSaved ? 'opacity-100' : 'opacity-0'
        }`}
      >
        ✓ Saved
      </span>
      <label htmlFor={id} className="text-sm font-medium">
        {question.label}
        {question.required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {question.description && (
        <p className="text-xs text-gray-500">{question.description}</p>
      )}

      {hasHub && !hasValue && (
        <div
          className={`flex items-center gap-2 rounded-md bg-indigo-50 px-3 py-2 text-sm transition-shadow ${
            justFilled ? 'ring-2 ring-indigo-300' : ''
          }`}
        >
          <span className="rounded bg-indigo-200 px-1.5 py-0.5 text-xs font-medium text-indigo-900">
            {justFilled ? '✦ from voice' : 'Pre-filled'}
          </span>
          <span className="truncate text-indigo-900">{String(hubValue)}</span>
          {lowConfidence && (
            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
              check this
            </span>
          )}
          <button
            type="button"
            tabIndex={-1}
            className="ml-auto rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 active:bg-indigo-800"
            onClick={() => {
              onChange({ value: hubValue, wasAcceptedAsIs: true });
              pulseImmediate();
            }}
          >
            Accept
          </button>
        </div>
      )}

      {question.type === 'text' && (
        <div className="relative">
          {!isLongText && (
            <input
              id={id}
              ref={textInput.ref as (el: HTMLInputElement | null) => void}
              disabled={isTranscribing}
              aria-invalid={missingStrong || undefined}
              className={`w-full rounded-md border ${inputBorderCls} px-3 py-2 pr-11 text-base disabled:bg-gray-50 disabled:opacity-60`}
              defaultValue={textInput.defaultValue}
              onChange={(e) => textInput.onChange(e.target.value)}
            />
          )}
          {isLongText && (
            <AutoGrowTextarea
              id={id}
              disabled={isTranscribing}
              value={valueStr}
              onChange={emitText}
              className="pr-11"
              invalid={missingStrong}
            />
          )}
          <VoiceDictation
            current={value == null ? '' : String(value)}
            onStatusChange={setDictationStatus}
            onAppended={(next) => {
              onChange({ value: next, wasAcceptedAsIs: false });
              pulseDebounced();
            }}
          />
        </div>
      )}
      {question.type === 'number' && (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          aria-invalid={missingStrong || undefined}
          className={`rounded-md border ${inputBorderCls} px-3 py-2 text-base`}
          value={value == null ? '' : String(value)}
          onChange={(e) => {
            onChange({
              value: e.target.value === '' ? null : Number(e.target.value),
              wasAcceptedAsIs: false,
            });
            pulseImmediate();
          }}
        />
      )}
      {question.type === 'date' && (
        <input
          id={id}
          type="date"
          aria-invalid={missingStrong || undefined}
          className={`rounded-md border ${inputBorderCls} px-3 py-2 text-base`}
          value={value == null ? '' : String(value)}
          onChange={(e) => {
            onChange({ value: e.target.value, wasAcceptedAsIs: false });
            pulseImmediate();
          }}
        />
      )}
      {question.type === 'select' && (
        <select
          id={id}
          aria-invalid={missingStrong || undefined}
          className={`rounded-md border ${inputBorderCls} px-3 py-2 text-base`}
          value={value == null ? '' : String(value)}
          onChange={(e) => {
            onChange({ value: e.target.value, wasAcceptedAsIs: false });
            pulseImmediate();
          }}
        >
          <option value="" />
          {question.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}
      {question.type === 'scale' && (
        <ScaleField
          question={question}
          value={value}
          onChange={onChange}
          onSelected={pulseImmediate}
        />
      )}
      {question.type === 'boolean' && (
        <div className="flex gap-2">
          {/* Hidden input keeps label htmlFor target resolvable for a11y/tests */}
          <input
            type="hidden"
            id={id}
            aria-label={question.label}
            aria-invalid={missingStrong || undefined}
          />
          <button
            type="button"
            aria-pressed={value === true}
            className={`flex-1 rounded-md px-4 py-3 text-base font-medium transition active:scale-[0.98] ${
              value === true
                ? 'bg-black text-white'
                : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
            onClick={() => {
              onChange({ value: true, wasAcceptedAsIs: false });
              pulseImmediate();
            }}
          >
            Yes
          </button>
          <button
            type="button"
            aria-pressed={value === false}
            className={`flex-1 rounded-md px-4 py-3 text-base font-medium transition active:scale-[0.98] ${
              value === false
                ? 'bg-black text-white'
                : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
            onClick={() => {
              onChange({ value: false, wasAcceptedAsIs: false });
              pulseImmediate();
            }}
          >
            No
          </button>
        </div>
      )}
    </div>
  );
}

// Textarea that grows with its content. Inspector-friendly: long observations
// stay visible without an inner scroll-trap. Min-height matches the old
// rows={3} baseline; max-height is intentionally unset so the card simply
// expands inside the surrounding flex column.
// Uncontrolled (defaultValue) to keep the caret stable on mid-string edits —
// see useEchoInput. The shared element ref comes from useEchoInput via inputRef
// so the parent can imperatively push external value changes (voice/Accept).
// We keep a local handle to the same node for auto-grow, and resize on every
// input event plus once on mount; because the element is uncontrolled there's
// no `value` prop to key the resize off, so we drive it from the live content.
function AutoGrowTextarea({
  id,
  value,
  onChange,
  disabled,
  className,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  // Strong missing-required state: red border + aria-invalid. Owned here (not
  // via className) so the border class swaps cleanly instead of conflicting.
  invalid?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  // Own caret-stable echo handle. resize() runs when an external value (voice
  // append / Accept) is written, since the uncontrolled element has no `value`
  // prop to key the auto-grow effect off.
  const echo = useEchoInput(value, onChange, resize);
  const setRef = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      ref.current = el as HTMLTextAreaElement | null;
      echo.ref(el);
    },
    [echo],
  );
  // Resize once after mount for the seeded default value.
  useLayoutEffect(resize, [resize]);
  return (
    <textarea
      ref={setRef}
      id={id}
      rows={3}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      className={`min-h-[5.25rem] w-full resize-none overflow-hidden rounded-md border ${
        invalid ? 'border-red-500' : 'border-gray-300'
      } px-3 py-2 text-base disabled:bg-gray-50 disabled:opacity-60 ${className ?? ''}`}
      defaultValue={echo.defaultValue}
      onChange={(e) => {
        echo.onChange(e.target.value);
        resize();
      }}
    />
  );
}

// Mic + recorder glue for one text field. Appends cleaned dictation to the
// current value; never overwrites. Rendered only for text-type fields. The
// current value is read through a ref so the hook's stable onResult always sees
// the latest text when stacking multiple dictations.
//
// Stacking is safe because recordings are strictly serial: useVoiceDictation
// only re-enters 'recording' from 'idle', and status returns to 'idle' in
// onStop's finally — after onResult has fired. So the parent's async onChange
// has flushed a fresh `current` prop into currentRef before a second dictation
// can complete. If onChange ever becomes optimistic/out-of-order, revisit this.
function VoiceDictation({
  current,
  onAppended,
  onStatusChange,
}: {
  current: string;
  onAppended: (next: string) => void;
  onStatusChange?: (status: DictationStatus) => void;
}) {
  const currentRef = useRef(current);
  currentRef.current = current;
  const onResult = useCallback(
    (text: string) => onAppended(appendDictation(currentRef.current, text)),
    [onAppended],
  );
  const { status, online, elapsedMs, onStart, onStop } = useVoiceDictation(onResult);
  // Report status up so the parent can lock the field while transcribing. Effect
  // (not render-time) keeps the parent's setState out of this component's render.
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);
  return (
    <div className="absolute right-1.5 top-1.5">
      <VoiceDictationButton
        status={status}
        online={online}
        elapsedMs={elapsedMs}
        onStart={onStart}
        onStop={onStop}
      />
    </div>
  );
}

// type=repeater is a stub: the sub-form schema lands in a later session. For
// now we let the inspector add free-text items so demos can still capture them.
export function RepeaterStub({
  question,
  value,
  onChange,
}: {
  question: FirstVisitQuestion;
  value: unknown;
  onChange: (next: { value: unknown; wasAcceptedAsIs: boolean }) => void;
}) {
  const items: string[] = Array.isArray(value) ? (value as string[]) : [];
  const set = (next: string[]) => onChange({ value: next, wasAcceptedAsIs: false });
  return (
    <div className="flex flex-col gap-2 p-2">
      <label className="text-sm font-medium">
        {question.label}
        {question.required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {question.description && (
        <p className="text-xs text-gray-500">{question.description}</p>
      )}
      <p className="text-[11px] italic text-gray-400">
        Sub-form schema not finalised yet — add free-text items for now.
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              value={item}
              onChange={(e) => {
                const next = items.slice();
                next[i] = e.target.value;
                set(next);
              }}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => set(items.filter((_, j) => j !== i))}
              className="text-xs text-gray-400 hover:text-red-500"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => set([...items, ''])}
        className="self-start rounded border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
      >
        + Add item
      </button>
    </div>
  );
}
