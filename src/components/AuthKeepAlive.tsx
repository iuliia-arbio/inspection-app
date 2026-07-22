'use client';
import { useEffect } from 'react';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';

// Mounted app-wide (root layout). Keeps the hub auth session fresh on the
// client so an inspector isn't logged out partway through a visit.
//
// Two things kept people logged out before this existed:
//  1. Nothing refreshed the token client-side, so it expired ~1h in and the
//     next burst of requests raced the server-side refresh. Instantiating the
//     cookie-based browser client starts its background auto-refresh loop.
//  2. On a phone, switching to the camera / another app backgrounds the webview.
//     On return the token is often stale; we refresh eagerly on foreground so
//     the very next tap doesn't hit an expired session.
export default function AuthKeepAlive() {
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;

    // Priming getSession() loads the stored session and starts auto-refresh.
    supabase.auth.getSession();

    const onVisible = () => {
      if (document.visibilityState === 'visible') supabase.auth.getSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return null;
}
