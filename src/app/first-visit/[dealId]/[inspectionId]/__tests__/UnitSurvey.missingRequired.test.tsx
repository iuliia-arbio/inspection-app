import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnitSurvey } from '../UnitSurvey';
import { localDb, type LocalAnswer } from '@/lib/firstVisit/db';
import { SurveyConfigProvider } from '@/lib/firstVisit/SurveyConfigContext';
import { MISSING_REQUIRED_TEXT } from '@/components/firstVisit/PrefilledField';
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

function answerRow(slug: string, value: unknown, areaKey = 'p1'): LocalAnswer {
  return {
    id: `a-${slug}`,
    inspection_id: 'i1',
    target_id: 'tgt-1',
    scope: 'location',
    location_id: 'loc-1',
    question_key: slug,
    area_key: areaKey,
    step_index: null,
    value,
    data_point_slug: slug,
    was_prefilled: false,
    was_accepted_as_is: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function seedMediaFor(slug: string, areaKey = 'p1') {
  await localDb.media.put({
    id: `m-${slug}`,
    inspection_id: 'i1',
    target_id: 'tgt-1',
    area_key: areaKey,
    question_key: slug,
    kind: 'photo',
    blob: new Blob(['x']),
    content_hash: 'h',
    size_bytes: 1,
    captured_at: new Date().toISOString(),
  });
}

// submitAttempt mirrors the VisitNavigator counter: 0 = no attempt yet.
function renderSurvey(submitAttempt: number, config: FirstVisitPhase[] = phases) {
  return render(
    <SurveyConfigProvider
      value={{ phases: config, allQuestions: config.flatMap((x) => x.questions) }}
    >
      <UnitSurvey
        inspectionId="i1"
        target={{ id: 'tgt-1', label: 'Property A' }}
        scope="location"
        ctx={{ deal_id: 'd1', location_id: 'loc-1' }}
        snapshot={null}
        onBack={vi.fn()}
        submitAttempt={submitAttempt}
      />
    </SurveyConfigProvider>,
  );
}

describe('UnitSurvey missing-required highlighting', () => {
  it('pre-attempt: an empty required field shows the subtle cue (no text); optional and answered fields show none', async () => {
    await localDb.answers.put(answerRow('opt_text', '')); // still empty
    renderSurvey(0);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());

    const req = screen.getByLabelText(/Required text/);
    expect(req.closest('[data-missing]')?.getAttribute('data-missing')).toBe('subtle');
    expect(req).not.toHaveAttribute('aria-invalid');
    expect(req).not.toHaveAttribute('aria-describedby');
    // Subtle stays calm — no helper text anywhere.
    expect(screen.queryByText(MISSING_REQUIRED_TEXT)).toBeNull();

    const opt = screen.getByLabelText(/Optional text/);
    expect(opt.closest('[data-missing]')).toBeNull();
  });

  it('post-attempt: an empty required field escalates to strong + aria-invalid + helper text wired via aria-describedby', async () => {
    renderSurvey(1);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());

    const req = screen.getByLabelText(/Required text/);
    expect(req.closest('[data-missing]')?.getAttribute('data-missing')).toBe('strong');
    expect(req).toHaveAttribute('aria-invalid', 'true');
    // Not color-only: helper text exists and the input points at it.
    const describedBy = req.getAttribute('aria-describedby');
    expect(describedBy).toBe('q-req_text-missing');
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      MISSING_REQUIRED_TEXT,
    );

    // Optional stays untouched even post-attempt.
    const opt = screen.getByLabelText(/Optional text/);
    expect(opt.closest('[data-missing]')).toBeNull();
    expect(opt).not.toHaveAttribute('aria-invalid');
  });

  it('an answered required field never shows a cue, pre- or post-attempt', async () => {
    await localDb.answers.put(answerRow('req_text', 'done'));
    renderSurvey(1);
    // The answers state loads async — assert the settled DOM.
    await waitFor(() =>
      expect(
        screen.getByLabelText(/Required text/).closest('[data-missing]'),
      ).toBeNull(),
    );
    const req = screen.getByLabelText(/Required text/);
    expect(req).not.toHaveAttribute('aria-invalid');
    expect(req).not.toHaveAttribute('aria-describedby');
  });

  it('a hidden required question renders nothing at all', async () => {
    renderSurvey(1);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());
    expect(screen.queryByText('Hidden required')).toBeNull();
  });

  it('required file question without media: strong cue + helper text post-attempt', async () => {
    renderSurvey(1);
    await waitFor(() => expect(screen.getByText('Required photo')).toBeInTheDocument());

    const container = screen.getByText('Required photo').closest('[data-missing]');
    expect(container?.getAttribute('data-missing')).toBe('strong');
    // The non-color-only helper renders inside the capture container.
    expect(container?.textContent).toContain(MISSING_REQUIRED_TEXT);
  });

  it('required file question WITH media: no cue at all, even post-attempt', async () => {
    await seedMediaFor('req_photo');
    renderSurvey(1);
    await waitFor(() => expect(screen.getByText('Required photo')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByText('Required photo').closest('[data-missing]')).toBeNull(),
    );
  });

  it('section chip shows the missing marker post-attempt, and drops it once required items are covered (media counts for file questions)', async () => {
    renderSurvey(1);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());
    // req_text and req_photo are both missing → chip flagged.
    expect(screen.getByTestId('chip-missing-p1')).toBeInTheDocument();
  });

  it('no chip marker pre-attempt, and none once everything required is answered (file via media)', async () => {
    await localDb.answers.put(answerRow('req_text', 'done'));
    await seedMediaFor('req_photo');

    const first = renderSurvey(0);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());
    expect(screen.queryByTestId('chip-missing-p1')).toBeNull();
    first.unmount();

    renderSurvey(1);
    await waitFor(() => expect(screen.getByText('Required text')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId('chip-missing-p1')).toBeNull());
  });
});

// Two phases so the jump has somewhere to go: phase 1 answered, phase 2 not.
const twoPhases: FirstVisitPhase[] = [
  {
    id: 'p1',
    label: 'Phase 1',
    questions: [{ ...baseQ, slug: 'p1_req', label: 'P1 required', required: true }],
  },
  {
    id: 'p2',
    label: 'Phase 2',
    questions: [
      {
        ...baseQ,
        slug: 'p2_req',
        label: 'P2 required',
        required: true,
        phase_id: 'p2',
        phase_label: 'Phase 2',
      },
    ],
  },
];

describe('UnitSurvey jump to first missing section after a submit attempt', () => {
  it('opens on the first phase with missing required work post-attempt', async () => {
    await localDb.answers.put(answerRow('p1_req', 'done'));
    renderSurvey(1, twoPhases);

    // Phase 1 is complete, phase 2 is not → the survey lands on Phase 2.
    await waitFor(() =>
      expect(screen.getByLabelText(/P2 required/)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/P1 required/)).toBeNull();
  });

  it('jumps only ONCE per attempt — manual navigation afterwards sticks', async () => {
    const user = userEvent.setup();
    await localDb.answers.put(answerRow('p1_req', 'done'));
    renderSurvey(1, twoPhases);
    await waitFor(() =>
      expect(screen.getByLabelText(/P2 required/)).toBeInTheDocument(),
    );

    // Inspector navigates back to Phase 1 — the consumed attempt must not
    // yank them back to Phase 2 on subsequent renders.
    await user.click(screen.getByRole('button', { name: /Phase 1/ }));
    await waitFor(() =>
      expect(screen.getByLabelText(/P1 required/)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/P2 required/)).toBeNull();
  });

  it('a fully answered survey stays on its first phase (no jump)', async () => {
    await localDb.answers.put(answerRow('p1_req', 'done'));
    await localDb.answers.put(answerRow('p2_req', 'done', 'p2'));
    renderSurvey(1, twoPhases);

    await waitFor(() =>
      expect(screen.getByLabelText(/P1 required/)).toBeInTheDocument(),
    );
    // Give the async jump check a beat, then confirm we never left Phase 1.
    await waitFor(() =>
      expect(screen.queryByLabelText(/P2 required/)).toBeNull(),
    );
    expect(screen.getByLabelText(/P1 required/)).toBeInTheDocument();
  });

  it('no jump without a submit attempt', async () => {
    await localDb.answers.put(answerRow('p1_req', 'done'));
    renderSurvey(0, twoPhases);
    await waitFor(() =>
      expect(screen.getByLabelText(/P1 required/)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/P2 required/)).toBeNull();
  });
});
