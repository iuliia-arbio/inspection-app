'use client';

import { useEffect, useMemo, useState } from 'react';
import { XIcon } from '@/components/icons';
import {
  questionEditorSchema,
  FIELD_TYPES,
  HUB_SCOPES,
} from '@/lib/firstVisit/editorSchema';
import type { ContentQuestion } from '@/lib/firstVisit/surveyConfig';
import type { OverlayEntry } from '@/lib/firstVisit/surveyConfig';

type Props = {
  question: ContentQuestion;
  overlay?: OverlayEntry;
  onChange: (q: ContentQuestion) => void;
  onValidityChange?: (ok: boolean) => void;
};

// A single editable survey question. Controlled: every edit produces a fresh
// ContentQuestion via `onChange`, and validity is recomputed (zod safeParse) and
// reported through `onValidityChange`. We use plain controlled inputs + a manual
// safeParse rather than react-hook-form: a row is a flat handful of fields with
// one cross-field rule (select needs options), so RHF's machinery would add more
// ceremony than it removes, and the parent already owns the canonical state.
export function QuestionEditorRow({
  question,
  overlay,
  onChange,
  onValidityChange,
}: Props) {
  const [optionDraft, setOptionDraft] = useState('');

  // Validate the current question values and surface field errors.
  const parsed = useMemo(
    () => questionEditorSchema.safeParse(question),
    [question],
  );
  const optionsError = parsed.success
    ? null
    : parsed.error.issues.find((i) => i.path[0] === 'options')?.message ?? null;

  // Report validity whenever it flips.
  useEffect(() => {
    onValidityChange?.(parsed.success);
  }, [parsed.success, onValidityChange]);

  const showOptions =
    question.type === 'select' || question.multi_select === true;

  function patch(changes: Partial<ContentQuestion>) {
    onChange({ ...question, ...changes });
  }

  function addOption() {
    const v = optionDraft.trim();
    if (!v) return;
    patch({ options: [...question.options, v] });
    setOptionDraft('');
  }

  function removeOption(index: number) {
    patch({ options: question.options.filter((_, i) => i !== index) });
  }

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs text-gray-500">{question.slug}</span>
        <OverlayBadges overlay={overlay} />
      </div>

      <label className="block text-sm">
        <span className="text-gray-600">Label</span>
        <input
          type="text"
          aria-label="Label"
          value={question.label}
          onChange={(e) => patch({ label: e.target.value })}
          className="mt-1 block w-full rounded border px-2 py-1"
        />
      </label>

      <label className="mt-2 block text-sm">
        <span className="text-gray-600">Description</span>
        <textarea
          aria-label="Description"
          value={question.description ?? ''}
          onChange={(e) => patch({ description: e.target.value })}
          className="mt-1 block w-full rounded border px-2 py-1"
        />
      </label>

      <div className="mt-2 flex flex-wrap gap-3">
        <label className="block text-sm">
          <span className="text-gray-600">Type</span>
          <select
            aria-label="Type"
            value={question.type}
            onChange={(e) =>
              patch({ type: e.target.value as ContentQuestion['type'] })
            }
            className="mt-1 block rounded border px-2 py-1"
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-gray-600">Scope</span>
          <select
            aria-label="Scope"
            value={question.scope}
            onChange={(e) =>
              patch({ scope: e.target.value as ContentQuestion['scope'] })
            }
            className="mt-1 block rounded border px-2 py-1"
          >
            {HUB_SCOPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            aria-label="Required"
            checked={question.required}
            onChange={(e) => patch({ required: e.target.checked })}
          />
          <span>Required</span>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            aria-label="Multi-select"
            checked={question.multi_select ?? false}
            onChange={(e) => patch({ multi_select: e.target.checked })}
          />
          <span>Multi-select</span>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            aria-label="Allow custom options"
            checked={question.allow_custom_options ?? false}
            onChange={(e) => patch({ allow_custom_options: e.target.checked })}
          />
          <span>Allow custom options</span>
        </label>
      </div>

      {showOptions && (
        <div className="mt-2 text-sm">
          <span className="text-gray-600">Options</span>
          <ul className="mt-1 flex flex-wrap gap-2">
            {question.options.map((opt, i) => (
              <li
                key={`${opt}-${i}`}
                className="flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5"
              >
                <span>{opt}</span>
                <button
                  type="button"
                  aria-label={`Remove option ${opt}`}
                  onClick={() => removeOption(i)}
                  className="text-gray-500 hover:text-red-600"
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              aria-label="New option"
              value={optionDraft}
              onChange={(e) => setOptionDraft(e.target.value)}
              className="rounded border px-2 py-1"
            />
            <button
              type="button"
              onClick={addOption}
              className="rounded border px-2 py-1"
            >
              Add
            </button>
          </div>
          {optionsError && (
            <p role="alert" className="mt-1 text-red-600">
              {optionsError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Read-only structural context pulled from the engineer-owned overlay. These are
// never editable here — changing wiring is a code change in questionStructure.ts.
function OverlayBadges({ overlay }: { overlay?: OverlayEntry }) {
  if (!overlay) return null;
  const badges: string[] = [];
  if (overlay.group_id) badges.push(`repeater: ${overlay.group_id}`);
  if (overlay.pms_target) badges.push(`pms: ${overlay.pms_target}`);
  if (overlay.follow_up || overlay.per_option_follow_up)
    badges.push('conditional follow-up');
  if (overlay.anchor_to) badges.push('anchored');
  if (badges.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <span
          key={b}
          className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500"
        >
          {b}
        </span>
      ))}
    </span>
  );
}
