import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// createServerClient is the only external the middleware depends on. Mock it so
// each test can drive auth.getUser() into a specific outcome (valid user,
// no session, or a transient failure) and assert what the gate does.
const getUser = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { middleware } from '../../middleware';

const HUB = 'https://hub.supabase.co';
const ANON = 'anon-key';

// A realistic Supabase auth cookie name: `sb-<ref>-auth-token`. Its presence is
// how we tell "session exists but couldn't be verified right now" (transient)
// apart from "genuinely signed out" (no cookie at all).
const AUTH_COOKIE = 'sb-hubref-auth-token=eyJhbGciOi.session.token';

function reqFor(path: string, { cookie }: { cookie?: string } = {}) {
  return new NextRequest(`https://app.example.com${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

function isLoginRedirect(res: Response) {
  const loc = res.headers.get('location');
  return res.status >= 300 && res.status < 400 && !!loc && new URL(loc).pathname === '/login';
}

describe('middleware auth gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_HUB_SUPABASE_URL = HUB;
    process.env.NEXT_PUBLIC_HUB_SUPABASE_ANON_KEY = ANON;
    delete process.env.NEXT_PUBLIC_DEV_SKIP_AUTH;
  });

  it('lets a valid staff user through', async () => {
    getUser.mockResolvedValue({ data: { user: { email: 'amal@arbio.com' } }, error: null });
    const res = await middleware(reqFor('/inspect/deal1', { cookie: AUTH_COOKIE }));
    expect(isLoginRedirect(res)).toBe(false);
  });

  it('redirects a genuinely signed-out request (no session cookie) to /login', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await middleware(reqFor('/inspect/deal1'));
    expect(isLoginRedirect(res)).toBe(true);
  });

  it('redirects an authenticated non-staff email to /login', async () => {
    getUser.mockResolvedValue({ data: { user: { email: 'stranger@gmail.com' } }, error: null });
    const res = await middleware(reqFor('/inspect/deal1', { cookie: AUTH_COOKIE }));
    expect(isLoginRedirect(res)).toBe(true);
  });

  // --- The Amal bug: a transient getUser failure must NOT eject a live session ---

  it('does NOT log out when getUser returns a transient error but a session cookie is present', async () => {
    // e.g. refresh-token rotation race or a flaky on-site connection: the auth
    // server round-trip fails, but the user still has a session cookie.
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid Refresh Token: Already Used', status: 400 },
    });
    const res = await middleware(reqFor('/inspect/deal1', { cookie: AUTH_COOKIE }));
    expect(isLoginRedirect(res)).toBe(false);
  });

  it('does NOT log out when getUser throws (network drop) but a session cookie is present', async () => {
    getUser.mockRejectedValue(new Error('fetch failed'));
    const res = await middleware(reqFor('/inspect/deal1', { cookie: AUTH_COOKIE }));
    expect(isLoginRedirect(res)).toBe(false);
  });
});
