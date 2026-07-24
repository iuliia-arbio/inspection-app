'use client';
import { useEffect, useState } from 'react';
import { WifiOffIcon, CheckIcon } from '@/components/icons';
import { useOnlineStatus } from '@/lib/firstVisit/useOnlineStatus';

/**
 * Sticky banner that reassures inspectors when they lose signal.
 * - Shows an amber "offline" banner while offline.
 * - When the user comes back online, briefly shows a green
 *   "Back online" state for ~2s, then disappears.
 * - Pointer events disabled so it never blocks taps below.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (!online) {
      setWasOffline(true);
      setShowReconnected(false);
      return;
    }
    if (online && wasOffline) {
      setShowReconnected(true);
      const t = setTimeout(() => {
        setShowReconnected(false);
        setWasOffline(false);
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [online, wasOffline]);

  if (online && !showReconnected) return null;

  const offline = !online;
  const classes = offline
    ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-green-50 text-green-800 border-green-200';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none sticky top-0 z-40 flex w-full justify-center px-2 pt-2"
    >
      <div
        className={`pointer-events-none rounded-md border px-3 py-1.5 text-xs sm:text-sm shadow-sm ${classes}`}
      >
        {offline ? (
          <span>
            <WifiOffIcon className="inline h-4 w-4 shrink-0" />{' '}
            You&apos;re offline — answers are saving locally and will sync when you reconnect.
          </span>
        ) : (
          <span>
            <CheckIcon className="inline h-4 w-4 shrink-0" /> Back online — syncing…
          </span>
        )}
      </div>
    </div>
  );
}
