'use client';
import { useState } from 'react';
import { useOnlineStatus } from '@/lib/firstVisit/useSyncEngine';

// The universally recognised "sync" glyph (two arrows chasing a circle —
// Feather's refresh-cw). Inline + currentColor so it inherits the state colour
// and needs no icon dependency. Fixed 16px inside a fixed 28px button, so the
// badge never changes width — the header buttons no longer jump when sync state
// changes (the reason the old text badge stayed hidden while healthy).
function SyncIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// Always-present sync indicator. Three states, one fixed footprint:
//   • error  — online with STUCK jobs (>= 3 failed attempts): red icon + "!",
//     tap opens an inline panel with the actual server error + Retry. This is
//     the only place the failure reason is visible; a hover tooltip was useless
//     on touch devices, which is exactly why field failures looked mute.
//   • syncing/synced — online: a calm grey icon that spins while a drain is in
//     flight and rests otherwise ("your work is reaching the hub").
//   • offline — muted icon; retrying is pointless with no connection.
export function SyncBadge({
  pending,
  stuck = 0,
  lastError,
  syncing = false,
  onRetry,
}: {
  pending: number;
  stuck?: number;
  lastError?: string;
  syncing?: boolean;
  onRetry?: () => void;
}) {
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  void pending; // no longer surfaced as a number — kept for the engine's API

  // Error is the only interactive state: online + work that keeps failing.
  if (online && stuck > 0) {
    const label = `${stuck} change${stuck === 1 ? '' : 's'} not syncing`;
    return (
      <div className="relative inline-flex">
        <button
          type="button"
          aria-label={`${label} — tap for details`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="relative inline-flex h-7 w-7 items-center justify-center rounded-full text-red-600 hover:bg-red-50"
        >
          <SyncIcon />
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold leading-none text-white"
          >
            !
          </span>
        </button>
        {open ? (
          <div
            role="dialog"
            className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-red-200 bg-white p-3 text-left shadow-lg"
          >
            <p className="text-sm font-medium text-red-700">
              {stuck} change{stuck === 1 ? '' : 's'} can&apos;t reach the hub.
            </p>
            {lastError ? (
              <p className="mt-1 break-words font-mono text-[11px] leading-snug text-gray-600">
                {lastError}
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onRetry?.();
                  setOpen(false);
                }}
                className="flex-1 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (!online) {
    return (
      <span
        title="Offline — changes saved on this device"
        aria-label="Offline — changes saved on this device"
        className="inline-flex h-7 w-7 items-center justify-center text-gray-400"
      >
        <SyncIcon />
      </span>
    );
  }

  // Online + healthy: resting or spinning.
  return (
    <span
      title={syncing ? 'Syncing…' : 'All changes synced'}
      aria-label={syncing ? 'Syncing' : 'All changes synced'}
      className="inline-flex h-7 w-7 items-center justify-center text-gray-400"
    >
      <SyncIcon className={syncing ? 'animate-spin' : ''} />
    </span>
  );
}
