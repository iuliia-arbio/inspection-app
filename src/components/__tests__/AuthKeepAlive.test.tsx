import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const getSession = vi.fn().mockResolvedValue({ data: { session: null } });
vi.mock('@/lib/supabaseBrowser', () => ({
  getSupabaseBrowser: () => ({ auth: { getSession } }),
}));

import AuthKeepAlive from '../AuthKeepAlive';

describe('AuthKeepAlive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('primes the session on mount (starts the background refresh loop)', () => {
    render(<AuthKeepAlive />);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('refreshes the session when the tab returns to the foreground', () => {
    render(<AuthKeepAlive />);
    getSession.mockClear();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('renders nothing', () => {
    const { container } = render(<AuthKeepAlive />);
    expect(container.innerHTML).toBe('');
  });
});
