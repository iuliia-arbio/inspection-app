import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import VisitNavigator from '../VisitNavigator';
import { localDb, type LocalTarget } from '@/lib/firstVisit/db';
import { questionsForScope } from '@/lib/firstVisit/questions';

// Keep the sync engine inert and deterministic — this test is about the submit
// dialog's "what's left" list and the success state, not the outbox.
vi.mock('@/lib/firstVisit/useSyncEngine', () => ({
  useSyncEngine: () => ({ pending: 0, syncing: false, syncNow: vi.fn().mockResolvedValue(undefined) }),
  useOnlineStatus: () => true,
}));
vi.mock('@/lib/firstVisit/sync', () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  ensureInspectionQueued: vi.fn().mockResolvedValue(undefined),
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
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deal: { id: DEAL }, locations: [], units: [] }) }),
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
});
