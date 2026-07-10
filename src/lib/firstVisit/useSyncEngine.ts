'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { drainOutbox, outboxStats, type JobHandlers, type OutboxStats } from './sync';
import { useOnlineStatus } from './useOnlineStatus';

// Re-export so existing call sites (e.g. SyncBadge) keep working without
// changes. The single source of truth lives in `./useOnlineStatus`.
export { useOnlineStatus };

export function useSyncEngine(handlers: JobHandlers): {
  pending: number;
  stuck: number;
  lastError?: string;
  syncNow: () => Promise<void>;
  syncing: boolean;
} {
  const [stats, setStats] = useState<OutboxStats>({ pending: 0, stuck: 0 });
  const [syncing, setSyncing] = useState(false);
  const online = useOnlineStatus();

  // Keep the handlers in a ref so the public `syncNow` identity is stable
  // across renders. Without this, every setSyncing(true) rebuilds syncNow →
  // effects that depend on syncNow refire → call syncNow again → infinite
  // "syncing…" flicker.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const refresh = useCallback(async () => {
    setStats(await outboxStats());
  }, []);

  const syncNow = useCallback(async () => {
    // No duplicate-suppression here: drainOutbox is single-flight and returns
    // the shared in-flight promise, so concurrent callers JOIN the running
    // drain instead of starting a second one. The old early-return let
    // confirmSubmit's `await syncNow()` resolve mid-drain, count in-transit
    // jobs, and flash a false-positive submit gate that self-healed a second
    // later.
    setSyncing(true);
    try {
      await drainOutbox(handlersRef.current);
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  // Initial + periodic count refresh.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Trigger a sync when we come online. Drain-level errors are logged (not
  // swallowed) — per-JOB errors are already persisted on the outbox row and
  // surface through the `stuck` count.
  useEffect(() => {
    if (online) syncNow().catch((err) => console.error('[fv-sync] drain failed', err));
  }, [online, syncNow]);

  // Periodic background drain + on-focus drain.
  useEffect(() => {
    const id = setInterval(() => {
      if (navigator.onLine)
        syncNow().catch((err) => console.error('[fv-sync] drain failed', err));
    }, 30_000);
    const onFocus = () => {
      if (navigator.onLine)
        syncNow().catch((err) => console.error('[fv-sync] drain failed', err));
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [syncNow]);

  return {
    pending: stats.pending,
    stuck: stats.stuck,
    lastError: stats.lastError,
    syncNow,
    syncing,
  };
}
