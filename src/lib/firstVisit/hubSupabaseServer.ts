import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';

// Per-request, cookie-aware hub client for AUTHENTICATED write routes.
//
// Unlike `getHubSupabase()` (a module-level, cookieless singleton used for
// public GET reads), this builds a fresh client per request that reads the
// hub Supabase session from the incoming request cookies via @supabase/ssr.
// That session is what login (`exchangeCodeForSession`) writes, and it's the
// same pattern `middleware.ts` uses — so `auth.getUser()` resolves the user
// server-side and write routes no longer 401.

// `any` for the schema generic so the 'onboarding' override compiles —
// SupabaseClient defaults to the 'public' schema otherwise.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any, any, any>;

export async function getHubUserClient(): Promise<AnyClient | null> {
  const url = process.env.NEXT_PUBLIC_HUB_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_HUB_SUPABASE_ANON_KEY ?? '';
  if (!url || !key) return null;

  // `cookies()` is async in Next 15.
  const cookieStore = await cookies();

  return createServerClient(url, key, {
    // CRITICAL: the hub's first-visit tables live in the `onboarding` schema
    // (matches the old getHubSupabase). Omitting this breaks every query.
    db: { schema: 'onboarding' },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        // Setting cookies throws in some route-handler contexts (read-only
        // request scope). Swallow it — read-only getUser() still works, which
        // is all the write routes need.
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // no-op
        }
      },
    },
  });
}
