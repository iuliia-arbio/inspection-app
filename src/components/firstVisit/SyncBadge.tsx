'use client';
import { useOnlineStatus } from '@/lib/firstVisit/useSyncEngine';

// Quiet background signal. Syncing to the hub's outbox happens continuously and
// the inspector never acts on it, so we deliberately DON'T render an in-flight
// "Syncing…" badge — its changing width made the header buttons (Edit / Sync
// now / Export) jump every time a sync started or finished. Two states are
// worth surfacing: (1) offline with unsynced work, which reassures the
// inspector their data is safe on the device; (2) online with STUCK jobs
// (>= 3 failed attempts) — work silently failing to reach the hub, shown as a
// count + the last error + tap-to-retry. Healthy pending work renders nothing.
export function SyncBadge({
  pending,
  stuck = 0,
  lastError,
  onRetry,
}: {
  pending: number;
  stuck?: number;
  lastError?: string;
  onRetry?: () => void;
}) {
  const online = useOnlineStatus();
  if (!online) {
    // Offline takes precedence over stuck — retries are pointless offline.
    if (pending <= 0) return null;
    return (
      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
        Offline — changes saved on device
      </span>
    );
  }
  if (stuck > 0) {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={lastError ? `${lastError} — tap to retry` : 'Tap to retry'}
        className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
      >
        {stuck} not syncing
      </button>
    );
  }
  return null;
}
