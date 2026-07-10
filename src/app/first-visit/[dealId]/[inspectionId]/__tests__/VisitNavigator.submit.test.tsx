import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import VisitNavigator from '../VisitNavigator';
import { localDb, type LocalTarget } from '@/lib/firstVisit/db';
import { questionsForScope, type FirstVisitPhase, type FirstVisitQuestion } from '@/lib/firstVisit/questions';
import { SurveyConfigProvider } from '@/lib/firstVisit/SurveyConfigContext';

// Keep the sync engine inert and deterministic — this test is about the submit
// dialog's "what's left" list, the soft sync gate, and the success state, not
// the real outbox. pendingCountMock steers the gate per test.
const { pendingCountMock, syncNowMock } = vi.hoisted(() => ({
  pendingCountMock: vi.fn().mockResolvedValue(0),
  syncNowMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/firstVisit/useSyncEngine', () => ({
  useSyncEngine: () => ({
    pending: 0,
    stuck: 0,
    lastError: undefined,
    syncing: false,
    syncNow: syncNowMock,
  }),
  useOnlineStatus: () => true,
}));
vi.mock('@/lib/firstVisit/sync', () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  ensureInspectionQueued: vi.fn().mockResolvedValue(undefined),
  pendingCountForInspection: pendingCountMock,
}));
vi.mock('@/lib/firstVisit/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/firstVisit/export', () => ({ downloadInspectionZip: vi.fn() }));

import { track } from '@/lib/firstVisit/analytics';

const INSPECTION = 'insp-1';
const DEAL = 'deal-1';

async function seedProperty(status: 'draft' | 'submitted' = 'draft') {
  await localDb.targets.clear();
  await localDb.answers.clear();
  await localDb.inspections.clear();
  await localDb.inspections.put({
    id: INSPECTION,
    deal_id: DEAL,
    status,
  } as Parameters<typeof localDb.inspections.put>[0]);
  const prop: LocalTarget = {
    id: 'prop-1',
    inspection_id: INSPECTION,
    kind: 'property',
    location_id: 'loc-1',
    label: 'Main Building',
    created_on_site: false,
    order: 0,
  };
  await localDb.targets.put(prop);
}

beforeEach(() => {
  pendingCountMock.mockReset().mockResolvedValue(0);
  syncNowMock.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      // `points: []` keeps lookupHubValue happy when a survey is opened.
      json: async () => ({ deal: { id: DEAL }, locations: [], units: [], points: [] }),
    }),
  );
});

describe('VisitNavigator submit flow', () => {
  it('lists an unanswered visible-required question grouped by target, then shows success', async () => {
    await seedProperty();

    render(
      <VisitNavigator dealId={DEAL} inspectionId={INSPECTION} previewSnapshot={undefined} visitTitle="Test Visit" />,
    );

    // Wait for the seeded property to appear.
    await waitFor(() => expect(screen.getByText('Main Building')).toBeInTheDocument());

    // Open the submit dialog (the page-level submit button).
    fireEvent.click(screen.getByRole('button', { name: 'Submit visit' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // The property has zero answers, so its first visible-required location
    // question must be listed, grouped under the property label.
    const firstRequired = questionsForScope('location').find(
      (q) => q.required && !q.group_id && !q.visible_when,
    )!;
    expect(firstRequired).toBeTruthy();
    // Grouped under the property label, inside the dialog.
    expect(within(dialog).getByText('Main Building')).toBeInTheDocument();
    expect(within(dialog).getAllByText(firstRequired.label).length).toBeGreaterThan(0);

    // Reopen contract: the old lock copy is gone, the new promise is stated.
    expect(within(dialog).queryByText(/will not be able to edit/i)).toBeNull();
    expect(
      within(dialog).getByText(/reopen and edit this visit at any time/i),
    ).toBeInTheDocument();

    // Confirm submit → success state (the dialog's own submit button).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit visit' }));
    await waitFor(() => expect(screen.getByText(/Visit submitted/i)).toBeInTheDocument());

    const updated = await localDb.inspections.get(INSPECTION);
    expect(updated?.status).toBe('submitted');
  });

  it('shows Re-submit for a submitted visit and reopen-friendly dialog copy', async () => {
    await seedProperty('submitted');

    render(
      <VisitNavigator dealId={DEAL} inspectionId={INSPECTION} previewSnapshot={undefined} visitTitle="Test Visit" />,
    );

    // A submitted visit is reopenable: the page button reads Re-submit.
    const btn = await screen.findByRole('button', { name: 'Re-submit visit' });
    fireEvent.click(btn);

    const dialog = await screen.findByRole('dialog');
    // The old lock contract is gone:
    expect(within(dialog).queryByText(/will not be able to edit/i)).toBeNull();
    // The new contract is stated:
    expect(
      within(dialog).getByText(/reopen and edit this visit at any time/i),
    ).toBeInTheDocument();

    // Confirm re-submits (dialog button mirrors the page label).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-submit visit' }));
    await waitFor(() => expect(screen.getByText(/Visit submitted/i)).toBeInTheDocument());
    // Success copy states reopenability instead of finality.
    expect(screen.getByText(/reopen this visit later/i)).toBeInTheDocument();

    // The analytics event distinguishes a re-submit.
    expect(track).toHaveBeenCalledWith(
      'submit_clicked',
      expect.objectContaining({ inspection_id: INSPECTION, resubmit: true }),
    );
  });

  it('a submit attempt persists after cancel and escalates missing required fields in the survey', async () => {
    await seedProperty();
    Element.prototype.scrollIntoView = vi.fn();

    // Minimal runtime config: one location-scope phase with one required text
    // question, so the opened property survey has a deterministic missing field.
    const q: FirstVisitQuestion = {
      slug: 'req_text',
      label: 'Required text',
      description: null,
      scope: 'location',
      mode: 'data',
      type: 'text',
      options: [],
      required: true,
      repeater: false,
      pms_target: null,
      status: 'existing',
      verdict: null,
      notes: null,
      phase_id: 'p1',
      phase_label: 'Phase 1',
    };
    const phases: FirstVisitPhase[] = [{ id: 'p1', label: 'Phase 1', questions: [q] }];

    render(
      <SurveyConfigProvider value={{ phases, allQuestions: [q] }}>
        <VisitNavigator dealId={DEAL} inspectionId={INSPECTION} visitTitle="Test Visit" />
      </SurveyConfigProvider>,
    );
    await waitFor(() => expect(screen.getByText('Main Building')).toBeInTheDocument());

    // Open the submit dialog, then back out — the attempt must stick.
    fireEvent.click(screen.getByRole('button', { name: 'Submit visit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Open the property survey: the empty required field is now strong.
    fireEvent.click(screen.getByText('Tap to open property questions'));
    const input = await screen.findByLabelText(/Required text/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.closest('[data-missing]')?.getAttribute('data-missing')).toBe('strong');
  });

  it('soft-gates confirm when answers are still pending: warning + Retry + Submit anyway', async () => {
    await seedProperty();
    pendingCountMock.mockResolvedValue(2); // stays pending through the pre-drain
    render(<VisitNavigator dealId={DEAL} inspectionId={INSPECTION} visitTitle="Test Visit" />);
    await waitFor(() => expect(screen.getByText('Main Building')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Submit visit' }));
    const dialog = await screen.findByRole('dialog');
    // Gate copy (decision: "X answers haven't reached the hub yet"):
    expect(
      await within(dialog).findByText(/2 answers haven't reached the hub yet/i),
    ).toBeInTheDocument();
    // Never hard-blocked: an explicit override is offered instead of the plain confirm.
    expect(within(dialog).getByRole('button', { name: /Submit anyway/i })).toBeInTheDocument();
    // Retry drains and re-checks; when the count clears, the normal confirm returns.
    pendingCountMock.mockResolvedValue(0);
    fireEvent.click(within(dialog).getByRole('button', { name: /Retry/i }));
    await waitFor(() =>
      expect(within(dialog).queryByText(/haven't reached the hub/i)).toBeNull(),
    );
    expect(syncNowMock).toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Submit visit' })).toBeInTheDocument();
  });

  it('Submit anyway proceeds exactly like a normal submit', async () => {
    await seedProperty();
    pendingCountMock.mockResolvedValue(2);
    render(<VisitNavigator dealId={DEAL} inspectionId={INSPECTION} visitTitle="Test Visit" />);
    await waitFor(() => expect(screen.getByText('Main Building')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Submit visit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /Submit anyway/i }));
    await waitFor(() => expect(screen.getByText(/Visit submitted/i)).toBeInTheDocument());
    expect((await localDb.inspections.get(INSPECTION))?.status).toBe('submitted');
  });

  it('confirm drains first and re-checks: a gate appearing only at confirm time still catches', async () => {
    await seedProperty();
    render(<VisitNavigator dealId={DEAL} inspectionId={INSPECTION} visitTitle="Test Visit" />);
    await waitFor(() => expect(screen.getByText('Main Building')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Submit visit' }));
    const dialog = await screen.findByRole('dialog');
    // Let both dialog-open checks (immediate + post-drain) settle clean (0)
    // before flipping the mock, so the gate can only come from confirm's
    // own re-check.
    await waitFor(() => expect(pendingCountMock).toHaveBeenCalledTimes(2));
    pendingCountMock.mockResolvedValue(1); // by confirm time, a job is stuck
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit visit' }));
    expect(
      await within(dialog).findByText(/1 answer hasn't reached the hub yet/i),
    ).toBeInTheDocument();
    // NOT submitted:
    expect((await localDb.inspections.get(INSPECTION))?.status).toBe('draft');
  });
});
