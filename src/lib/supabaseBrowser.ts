'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Cookie-based browser client for the HUB (auth) project.
//
// This is the CLIENT half of the Supabase SSR auth setup that the app was
// missing. Unlike `getHubSupabase()` (plain supabase-js → localStorage, which
// the server/middleware can't read), `createBrowserClient` reads and writes the
// SAME auth cookies that `middleware.ts` and the server routes read. That makes
// the browser the primary token refresher: it keeps the cookie session fresh in
// the background, so the token no longer silently expires mid-visit and the
// middleware rarely has to refresh (which is where the rotation race that logged
// inspectors out came from).
let _client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_HUB_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_HUB_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (_client) return _client;
  _client = createBrowserClient(url, key);
  return _client;
}
