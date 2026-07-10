import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { UnitSurvey } from '../UnitSurvey';
import { localDb, type LocalAnswer } from '@/lib/firstVisit/db';
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

// One phase with: a required text, an optional text, a required file, and a
// gated required text (hidden until its controller is true).
const phases: FirstVisitPhase[] = [
  {
    id: 'p1',
    label: 'Phase 1',
    questions: [
      { ...baseQ, slug: 'req_text', label: 'Required text', required: true },
      { ...baseQ, slug: 'opt_text', label: 'Optional text' },
      { ...baseQ, slug: 'req_photo', label: 'Required photo', type: 'file', required: true },
      { ...baseQ, slug: 'gate', label: 'Gate', type: 'boolean' },
      {
        ...baseQ,
        slug: 'hidden_req',
        label: 'Hidden required',
        required: true,
        visible_when: { question: 'gate', equals: true },
      },
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
  // The required file question mounts MediaGallery: jsdom has no object URLs,
  // and blobs round-trip fake-indexeddb as plain objects — stub both, plus the
  // remote-media listing fetch.
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi
    .fn()
    .mockReturnValue('blob:mock');
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ media: [] }) }),
  );
});

afterEach(async () => {
  await localDb.answers.clear();
  await localDb.media.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function answerRow(slug: string, value: unknown): LocalAnswer {
  return {
    id: `a-${slug}`,
    inspection_id: 'i1',
    target_id: 'tgt-1',
    scope: 'location',
    location_id: 'loc-1',
    question_key: slug,
    area_key: 'p1',
    step_index: null,
    value,
    data_point_slug: slug,
    was_prefilled: false,
    was_accepted_as_is: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function renderSurvey(submitAttempted: boolean): ReactElement {
  return render(
    <SurveyConfigProvider
      value={{ phases, allQuestions: phases.flatMap((x) => x.questions) }}
    >
      <UnitSurvey
        inspectionId="i1"
        target={{ id: 'tgt-1', label: 'Property A' }}
        scope="location"
        ctx={{ deal_id: 'd1', location_id: 'loc-1' }}
        snapshot={null}
        onBack={vi.fn()}
        submitAttempted={submitAttempted}
      />
    </SurveyConfigProvider>,
  ) as unknown as ReactElement;
}

describe('UnitSurvey missing-required highlighting', () => {
  it('pre-attempt: an empty required field shows the subtle cue; optional and answered fields show none', async () => {
    await localDb.answers.put(answerRow('opt_text', '')); // still empty
    renderSurvey(false);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());

    const req = screen.getByLabelText(/Required text/);
    expect(req.closest('[data-missing]')?.getAttribute('data-missing')).toBe('subtle');
    expect(req).not.toHaveAttribute('aria-invalid');

    const opt = screen.getByLabelText(/Optional text/);
    expect(opt.closest('[data-missing]')).toBeNull();
  });

  it('post-attempt: an empty required field escalates to strong + aria-invalid', async () => {
    renderSurvey(true);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());

    const req = screen.getByLabelText(/Required text/);
    expect(req.closest('[data-missing]')?.getAttribute('data-missing')).toBe('strong');
    expect(req).toHaveAttribute('aria-invalid', 'true');

    // Optional stays untouched even post-attempt.
    const opt = screen.getByLabelText(/Optional text/);
    expect(opt.closest('[data-missing]')).toBeNull();
    expect(opt).not.toHaveAttribute('aria-invalid');
  });

  it('an answered required field never shows a cue, pre- or post-attempt', async () => {
    await localDb.answers.put(answerRow('req_text', 'done'));
    renderSurvey(true);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());

    const req = screen.getByLabelText(/Required text/);
    expect(req.closest('[data-missing]')).toBeNull();
    expect(req).not.toHaveAttribute('aria-invalid');
  });

  it('a hidden required question renders nothing at all', async () => {
    renderSurvey(true);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());
    expect(screen.queryByText('Hidden required')).toBeNull();
  });

  it('section chip shows the missing marker post-attempt, and drops it once required items are covered (media counts for file questions)', async () => {
    renderSurvey(true);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());
    // req_text and req_photo are both missing → chip flagged.
    expect(screen.getByTestId('chip-missing-p1')).toBeInTheDocument();
  });

  it('no chip marker pre-attempt, and none once everything required is answered (file via media)', async () => {
    await localDb.answers.put(answerRow('req_text', 'done'));
    await localDb.media.put({
      id: 'm1',
      inspection_id: 'i1',
      target_id: 'tgt-1',
      area_key: 'p1',
      question_key: 'req_photo',
      kind: 'photo',
      blob: new Blob(['x']),
      content_hash: 'h',
      size_bytes: 1,
      captured_at: new Date().toISOString(),
    });

    const { unmount } = renderSurvey(false) as unknown as { unmount: () => void };
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());
    expect(screen.queryByTestId('chip-missing-p1')).toBeNull();
    unmount();

    renderSurvey(true);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId('chip-missing-p1')).toBeNull());
  });
});
