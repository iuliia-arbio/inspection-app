import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// next/script just needs to exist and fire onLoad so the button becomes
// enabled — we don't need the real Next.js script-loading behavior in tests.
vi.mock('next/script', () => ({
  default: ({ onLoad }: { onLoad?: () => void }) => {
    onLoad?.();
    return null;
  },
}));

import { WifiSpeedTest } from '../WifiSpeedTest';

type Instance = {
  setParameter: ReturnType<typeof vi.fn>;
  addTestPoint: ReturnType<typeof vi.fn>;
  selectServer: ReturnType<typeof vi.fn>;
  onupdate?: (data: unknown) => void;
  onend?: (aborted: boolean) => void;
  getState: () => { dlStatus: string; ulStatus: string };
  start: ReturnType<typeof vi.fn>;
};

let lastInstance: Instance | null = null;
let startBehavior: 'succeed' | 'throw' | 'abortViaOnend' = 'succeed';

class FakeSpeedtest {
  setParameter = vi.fn();
  addTestPoint = vi.fn();
  selectServer = vi.fn();
  onupdate?: (data: unknown) => void;
  onend?: (aborted: boolean) => void;
  getState = () => ({ dlStatus: '123.4', ulStatus: '56.7' });
  start = vi.fn(() => {
    if (startBehavior === 'throw') {
      throw new Error('boom');
    }
    if (startBehavior === 'abortViaOnend') {
      this.onend?.(true);
    }
  });

  constructor() {
    lastInstance = this as unknown as Instance;
  }
}

beforeEach(() => {
  lastInstance = null;
  startBehavior = 'succeed';
  (window as unknown as { Speedtest?: unknown }).Speedtest = FakeSpeedtest;
});

afterEach(() => {
  delete (window as unknown as { Speedtest?: unknown }).Speedtest;
});

describe('WifiSpeedTest', () => {
  it('configures the single-server URL parameters and calls start() directly, without addTestPoint/selectServer', () => {
    render(<WifiSpeedTest onResult={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /run speed test/i }));

    expect(lastInstance).not.toBeNull();
    const instance = lastInstance!;
    expect(instance.setParameter).toHaveBeenCalledWith('url_dl', '/api/first-visit/speedtest/download');
    expect(instance.setParameter).toHaveBeenCalledWith('url_ul', '/api/first-visit/speedtest/upload');
    expect(instance.setParameter).toHaveBeenCalledWith('url_ping', '/api/first-visit/speedtest/ping');
    expect(instance.setParameter).toHaveBeenCalledWith('url_getIp', '/api/first-visit/speedtest/ping');
    expect(instance.addTestPoint).not.toHaveBeenCalled();
    expect(instance.selectServer).not.toHaveBeenCalled();
    expect(instance.start).toHaveBeenCalledTimes(1);
  });

  it('reports the result and shows done state when the test completes successfully', () => {
    const onResult = vi.fn();
    render(<WifiSpeedTest onResult={onResult} />);
    fireEvent.click(screen.getByRole('button', { name: /run speed test/i }));

    act(() => {
      lastInstance!.onend?.(false);
    });

    expect(onResult).toHaveBeenCalledWith({ downloadMbps: 123.4, uploadMbps: 56.7 });
    expect(screen.getByRole('button', { name: /run again/i })).toBeInTheDocument();
  });

  it('shows an error state when the underlying test reports failure via onend(aborted=true)', () => {
    render(<WifiSpeedTest onResult={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /run speed test/i }));

    act(() => {
      lastInstance!.onend?.(true);
    });

    expect(screen.getByText(/speed test failed/i)).toBeInTheDocument();
  });

  it('shows an error state when starting the test throws synchronously', () => {
    startBehavior = 'throw';
    render(<WifiSpeedTest onResult={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /run speed test/i }));

    expect(screen.getByText(/speed test failed/i)).toBeInTheDocument();
  });
});
