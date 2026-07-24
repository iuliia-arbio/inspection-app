import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The badge is now an always-present sync glyph with a fixed footprint (so the
// header buttons no longer jump). Three states: online-healthy (resting or
// spinning icon), offline (muted icon, reassurance in the label), and online
// with STUCK jobs (red icon + "!" that opens an inline panel with the real
// server error + Retry — the failure reason is finally visible on touch).
let ONLINE = true;
vi.mock('@/lib/firstVisit/useSyncEngine', () => ({ useOnlineStatus: () => ONLINE }));
import { SyncBadge } from '../SyncBadge';

beforeEach(() => {
  ONLINE = true;
});

describe('SyncBadge', () => {
  it('shows a resting synced icon while online and healthy', () => {
    render(<SyncBadge pending={0} stuck={0} syncing={false} />);
    expect(screen.getByLabelText(/all changes synced/i)).toBeInTheDocument();
  });

  it('reports a syncing state while a drain is in flight', () => {
    render(<SyncBadge pending={5} stuck={0} syncing />);
    expect(screen.getByLabelText(/^syncing$/i)).toBeInTheDocument();
  });

  it('shows a quiet offline indicator when offline', () => {
    ONLINE = false;
    render(<SyncBadge pending={3} />);
    expect(screen.getByLabelText(/offline — changes saved/i)).toBeInTheDocument();
  });

  it('never shows an alarming backlog number', () => {
    render(<SyncBadge pending={1158} stuck={0} />);
    expect(screen.queryByText(/1158|pending/i)).not.toBeInTheDocument();
  });

  it('online + stuck: red icon opens an inline panel with the error + Retry', () => {
    const onRetry = vi.fn();
    render(<SyncBadge pending={5} stuck={3} lastError="answers -> 500 boom" onRetry={onRetry} />);
    // Error text is hidden until the badge is tapped (no useless hover tooltip).
    expect(screen.queryByText(/boom/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /3 changes not syncing/i }));
    expect(screen.getByText(/answers -> 500 boom/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offline takes precedence over stuck (retries are pointless offline)', () => {
    ONLINE = false;
    render(<SyncBadge pending={3} stuck={2} lastError="boom" />);
    expect(screen.getByLabelText(/offline — changes saved/i)).toBeInTheDocument();
    expect(screen.queryByText(/not syncing/i)).toBeNull();
  });
});
