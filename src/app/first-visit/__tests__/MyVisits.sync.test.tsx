import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { localDb } from '@/lib/firstVisit/db';

// The visits list mounts the full sync engine: jobs enqueued elsewhere
// (DealPicker's inspection_upsert, deletes made in the navigator) used to sit
// until a survey opened. Cloud hydration is mocked out — this test is about
// the outbox, not the restore path.
vi.mock('@/lib/firstVisit/restore', () => ({
  restoreFromCloud: vi.fn().mockResolvedValue(undefined),
}));
const { answerHandler } = vi.hoisted(() => ({
  answerHandler: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/firstVisit/handlers', () => ({
  createHandlers: () => ({ answer_upsert: answerHandler }),
}));
import MyVisits from '../MyVisits';

beforeEach(() => {
  answerHandler.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deals: [] }) }),
  );
});

describe('MyVisits sync engine', () => {
  it('drains queued outbox work on mount — jobs no longer wait for a survey to open', async () => {
    await localDb.outbox.add({
      kind: 'answer_upsert',
      payload: { inspection_id: 'i1' },
      created_at: Date.now(),
      attempts: 0,
    });
    render(<MyVisits />);
    await waitFor(() => expect(answerHandler).toHaveBeenCalledOnce());
    expect(await localDb.outbox.count()).toBe(0);
  });

  it('surfaces stuck jobs on the visits list badge', async () => {
    await localDb.outbox.add({
      kind: 'media_upload', // no handler in the mock → survives the mount drain
      payload: { inspection_id: 'i1' },
      created_at: Date.now(),
      attempts: 3,
      last_error: 'PUT failed 500',
      last_attempt_at: Date.now(),
    });
    render(<MyVisits />);
    expect(
      await screen.findByRole('button', { name: /1 change not syncing/i }),
    ).toBeInTheDocument();
  });
});
