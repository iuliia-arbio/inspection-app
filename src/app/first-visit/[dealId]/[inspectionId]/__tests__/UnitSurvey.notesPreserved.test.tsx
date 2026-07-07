import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { UnitSurvey } from '../UnitSurvey';
import { localDb } from '@/lib/firstVisit/db';
import { SurveyConfigProvider } from '@/lib/firstVisit/SurveyConfigContext';
import type { FirstVisitPhase, FirstVisitQuestion } from '@/lib/firstVisit/questions';

const baseQ: FirstVisitQuestion = {
  slug: 'q',
  label: 'Q',
  description: null,
  scope: 'location',
  mode: 'data',
  type: 'text',
  options: [],
  required: false,
  repeater: false,
  pms_target: null,
  status: 'existing',
  verdict: null,
  notes: null,
  phase_id: 'p1',
  phase_label: 'Phase 1',
};

const phases: FirstVisitPhase[] = [
  {
    id: 'p1',
    label: 'Phase 1',
    questions: [
      { ...baseQ, slug: 'has_balcony', label: 'Is there a balcony?', type: 'boolean' },
    ],
  },
];

vi.mock('@/lib/firstVisit/questions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/firstVisit/questions')>(
    '@/lib/firstVisit/questions',
  );
  return {
    ...actual,
    areaKeyFor: (q: FirstVisitQuestion) => q.phase_id,
    groupIdFor: (q: FirstVisitQuestion) => q.group_id ?? null,
  };
});

vi.mock('@/lib/firstVisit/sync', () => ({ enqueue: vi.fn(async () => undefined) }));
vi.mock('@/lib/firstVisit/analytics', () => ({ track: vi.fn() }));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.confirm = vi.fn(() => true);
});

afterEach(async () => {
  await localDb.answers.clear();
  vi.clearAllMocks();
});

function renderSurvey(p: FirstVisitPhase[]): ReactElement {
  return render(
    <SurveyConfigProvider value={{ phases: p, allQuestions: p.flatMap((x) => x.questions) }}>
      <UnitSurvey
        inspectionId="i1"
        target={{ id: 'tgt-1', label: 'Property A' }}
        scope="location"
        ctx={{ deal_id: 'd1', location_id: 'loc-1' }}
        snapshot={null}
        onBack={vi.fn()}
      />
    </SurveyConfigProvider>,
  ) as unknown as ReactElement;
}

describe('UnitSurvey notes preservation on value change', () => {
  it('keeps an existing note on the answer row when the value is edited', async () => {
    const user = userEvent.setup();
    // Seed: an answer row that already carries an inspector note (as setNotes
    // would create) but a different value.
    await localDb.answers.put({
      id: 'a-noted',
      inspection_id: 'i1',
      target_id: 'tgt-1',
      scope: 'location',
      location_id: 'loc-1',
      question_key: 'has_balcony',
      area_key: 'p1',
      step_index: null,
      value: false,
      notes: 'railing looks loose — recheck',
      data_point_slug: 'has_balcony',
      was_prefilled: false,
      was_accepted_as_is: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    renderSurvey(phases);
    await waitFor(() =>
      expect(screen.getByText('Is there a balcony?')).toBeInTheDocument(),
    );

    // Change the value → the rewritten row must still carry the note.
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(async () => {
      const row = await localDb.answers.get('a-noted');
      expect(row?.value).toBe(true);
      expect(row?.notes).toBe('railing looks loose — recheck');
    });
  });
});
