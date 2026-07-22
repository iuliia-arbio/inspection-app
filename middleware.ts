import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAllowedEmail } from '@/lib/firstVisit/auth';

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();

  // Dev-only bypass for local UI preview without OAuth wiring.
  if (process.env.NEXT_PUBLIC_DEV_SKIP_AUTH === '1') {
    return NextResponse.next();
  }

  // Allow auth callback and public assets through.
  //
  // Speedtest routes + vendored LibreSpeed assets are deliberately unauthenticated:
  // supabase.auth.getUser() below is a network round-trip to Supabase, and LibreSpeed
  // opens 6 concurrent download + 3 upload streams plus ping/getIp — each paying that
  // round-trip skews ping and depresses measured throughput, and an expired session
  // mid-test returns a login redirect instead of bytes. Security tradeoff: these
  // endpoints expose no data (ping returns 204, download streams random bytes capped
  // at 100 MiB/request in its route, upload only counts received bytes and stores
  // nothing). The real cost is BILLING, not data: Vercel meters egress per GB, so a
  // ~300-byte unauthenticated GET can pull 100 MiB of metered egress (~350,000x
  // amplification) with no rate limit — an abuser looping the download route runs up
  // the bandwidth bill. ACCEPTED tradeoff for now; if abused, mitigate with a Vercel
  // WAF rate-limit rule on /api/first-visit/speedtest/* (a few req/s per IP) rather
  // than re-adding auth here. /vendor/ is static LGPL client JS.
  if (
    url.pathname.startsWith('/auth/callback') ||
    url.pathname.startsWith('/_next') ||
    url.pathname.startsWith('/api/auth') ||
    url.pathname.startsWith('/api/first-visit/speedtest/') ||
    url.pathname.startsWith('/vendor/') ||
    url.pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // Bail if hub Supabase env isn't configured (e.g. local preview without secrets).
  if (
    !process.env.NEXT_PUBLIC_HUB_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_HUB_SUPABASE_ANON_KEY
  ) {
    if (url.pathname === '/login') return NextResponse.next();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_HUB_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_HUB_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set({ name, value, ...options }),
          );
        },
      },
    },
  );

  // Whether the request already carries a Supabase auth session cookie
  // (`sb-<ref>-auth-token`, possibly chunked as `.0`/`.1`). This is how we tell
  // "signed in but couldn't verify right now" apart from "genuinely signed out".
  const hasAuthCookie = req.cookies
    .getAll()
    .some((c) => c.name.includes('auth-token'));

  let user: { email?: string } | null = null;
  let verifyFailed = false;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    // getUser resolves with an error (rather than throwing) on refresh-token
    // rotation races and other transient auth-server failures. Treat that as a
    // failure to VERIFY, not proof of sign-out.
    if (!user && result.error) verifyFailed = true;
  } catch {
    // Network drop to the auth server (on-site connectivity). Also a verify
    // failure, never a hard sign-out.
    verifyFailed = true;
  }

  // A verified staff user — the normal path.
  if (user && isAllowedEmail(user.email)) return res;

  // Could not verify, but the browser still holds a session cookie. Do NOT eject
  // mid-inspection over a transient hiccup (rotation race / flaky signal): let
  // the request through so the client-side keepalive can refresh the token. The
  // gate still rejects genuinely cookieless requests below. Logged so a real
  // recurrence is diagnosable from the runtime logs rather than invisible.
  if (!user && verifyFailed && hasAuthCookie) {
    console.warn('[auth] getUser could not verify but session cookie present — allowing through', {
      path: url.pathname,
    });
    return res;
  }

  // Genuinely signed out (no session), or authenticated as a non-staff email.
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!login|auth/callback|_next/static|_next/image|favicon.ico).*)'],
};
