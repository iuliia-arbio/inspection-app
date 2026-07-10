import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The badge no longer shows an in-flight "Syncing…" message (that caused header
// layout jitter). It surfaces two states: offline with unsynced work (a quiet,
// non-alarming reassurance) and online with STUCK jobs (work silently failing
// to reach the hub — count + last error + tap-to-retry). Everything else
// renders nothing.
let ONLINE = true;
vi.mock('@/lib/firstVisit/useSyncEngine', () => ({ useOnlineStatus: () => ONLINE }));
import { SyncBadge } from '../SyncBadge';

beforeEach(() => {
  ONLINE = true;
});

describe('SyncBadge', () => {
  it('renders nothing while online, even with pending work (no syncing badge)', () => {
    const { container } = render(<SyncBadge pending={5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while online with no pending work', () => {
    const { container } = render(<SyncBadge pending={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a quiet offline note when offline with unsynced work', () => {
    ONLINE = false;
    render(<SyncBadge pending={3} />);
    expect(screen.getByText(/Offline — changes saved/i)).toBeInTheDocument();
  });

  it('renders nothing when offline with no pending work', () => {
    ONLINE = false;
    const { container } = render(<SyncBadge pending={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('never shows an alarming backlog number', () => {
    ONLINE = false;
    render(<SyncBadge pending={1158} />);
    expect(screen.queryByText(/1158|pending/i)).not.toBeInTheDocument();
  });

  it('shows a failing state when online with stuck jobs: count + retry + last error', () => {
    const onRetry = vi.fn();
    render(<SyncBadge pending={5} stuck={3} lastError="answers -> 500 boom" onRetry={onRetry} />);
    const badge = screen.getByRole('button', { name: /3 not syncing/i });
    expect(badge).toHaveAttribute('title', expect.stringContaining('boom'));
    fireEvent.click(badge);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('healthy pending work while online still renders nothing', () => {
    const { container } = render(<SyncBadge pending={5} stuck={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offline takes precedence over stuck (retries are pointless offline)', () => {
    ONLINE = false;
    render(<SyncBadge pending={3} stuck={2} lastError="boom" />);
    expect(screen.getByText(/Offline — changes saved/i)).toBeInTheDocument();
    expect(screen.queryByText(/not syncing/i)).toBeNull();
  });
});
