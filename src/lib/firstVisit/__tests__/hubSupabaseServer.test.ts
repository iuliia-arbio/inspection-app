import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the cookie store (`cookies()` is async in Next 15).
const getAll = vi.fn(() => [{ name: 'sb-access-token', value: 'tok' }]);
const set = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll, set })),
}));

// Capture what we pass into createServerClient.
const createServerClient = vi.fn((..._args: unknown[]) => ({ marker: 'client' }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => createServerClient(...args),
}));

import { getHubUserClient } from '../hubSupabaseServer';

const asMock = (fn: unknown) => fn as never as ReturnType<typeof vi.fn>;

describe('getHubUserClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_HUB_SUPABASE_URL = 'https://hub.supabase.co';
    process.env.NEXT_PUBLIC_HUB_SUPABASE_ANON_KEY = 'anon-key';
  });

  it('returns null when hub env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_HUB_SUPABASE_URL;
    expect(await getHubUserClient()).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('passes hub url/key, onboarding schema, and wires getAll to the cookie store', async () => {
    const client = await getHubUserClient();
    expect(client).toEqual({ marker: 'client' });

    const [url, key, opts] = asMock(createServerClient).mock.calls[0] as [
      string,
      string,
      { db?: { schema?: string }; cookies: { getAll: () => unknown; setAll: (t: unknown[]) => void } },
    ];
    expect(url).toBe('https://hub.supabase.co');
    expect(key).toBe('anon-key');
    expect(opts.db?.schema).toBe('onboarding');

    // getAll delegates to the cookie store.
    expect(opts.cookies.getAll()).toEqual([{ name: 'sb-access-token', value: 'tok' }]);
    expect(getAll).toHaveBeenCalled();
  });

  it('setAll writes each cookie and swallows errors from a read-only store', async () => {
    await getHubUserClient();
    const opts = asMock(createServerClient).mock.calls[0][2] as {
      cookies: { setAll: (t: { name: string; value: string; options?: unknown }[]) => void };
    };

    opts.cookies.setAll([{ name: 'a', value: '1', options: { path: '/' } }]);
    expect(set).toHaveBeenCalledWith('a', '1', { path: '/' });

    // A throwing store must not propagate.
    set.mockImplementationOnce(() => {
      throw new Error('read-only');
    });
    expect(() => opts.cookies.setAll([{ name: 'b', value: '2' }])).not.toThrow();
  });
});
