import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { localDb } from '../db';
import { useOnlineStatus, useSyncEngine } from '../useSyncEngine';
import type { JobHandlers } from '../sync';

describe('useOnlineStatus', () => {
  it('starts with navigator.onLine value', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(navigator.onLine);
  });

  it('updates on offline/online events', () => {
    const { result } = renderHook(() => useOnlineStatus());
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });
});

describe('useSyncEngine', () => {
  it('exposes stuck count + last error from the outbox', async () => {
    // A kind with NO handler survives the on-mount drain (drainOnce skips it),
    // so the seeded stuck row is still there when the hook refreshes stats.
    await localDb.outbox.add({
      kind: 'media_upload',
      payload: { inspection_id: 'i1' },
      created_at: 1,
      attempts: 3,
      last_error: 'boom',
      last_attempt_at: 1,
    });
    const { result } = renderHook(() => useSyncEngine({} as JobHandlers));
    await waitFor(() => expect(result.current.stuck).toBe(1));
    expect(result.current.lastError).toBe('boom');
    expect(result.current.pending).toBe(1);
  });

  it('drains on mount when online and refreshes counts', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await localDb.outbox.add({
      kind: 'answer_upsert',
      payload: { inspection_id: 'i1' },
      created_at: 1,
      attempts: 0,
    });
    const { result } = renderHook(() =>
      useSyncEngine({ answer_upsert: handler } as unknown as JobHandlers),
    );
    await waitFor(() => expect(handler).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.pending).toBe(0));
    expect(result.current.stuck).toBe(0);
  });
});
