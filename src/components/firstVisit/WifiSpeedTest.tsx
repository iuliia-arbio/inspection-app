'use client';
import Script from 'next/script';
import { useRef, useState } from 'react';

type SpeedTestResult = { downloadMbps: number; uploadMbps: number };

// Ambient type for the vendored LibreSpeed client (public/vendor/librespeed/speedtest.js).
// LICENSING NOTE: LibreSpeed's client is LGPL-3.0 (github.com/librespeed/speedtest).
// We vendor the files verbatim/unmodified and load them as separate static assets
// (not bundled into our app code) — see public/vendor/librespeed/README.md for the
// full license rationale.
type LibreSpeedState = {
  dlStatus: string;
  ulStatus: string;
  pingStatus: string;
  jitterStatus: string;
  testState: number;
};

type LibreSpeedInstance = {
  setParameter: (name: string, value: unknown) => void;
  addTestPoint: (point: {
    name: string;
    server: string;
    dlURL: string;
    ulURL: string;
    pingURL: string;
    getIpURL: string;
  }) => void;
  onupdate: (data: { testState: number; dlProgress: number; ulProgress: number; dlStatus: string; ulStatus: string }) => void;
  onend: (aborted: boolean) => void;
  getState: () => LibreSpeedState;
  start: () => void;
};

declare global {
  interface Window {
    Speedtest?: new () => LibreSpeedInstance;
  }
}

export function WifiSpeedTest({
  onResult,
}: {
  onResult: (result: SpeedTestResult) => void;
}) {
  const [status, setStatus] = useState<'idle' | 'loading-script' | 'ready' | 'running' | 'done' | 'error'>('loading-script');
  const [progress, setProgress] = useState<{ dl: number; ul: number }>({ dl: 0, ul: 0 });
  const testRef = useRef<LibreSpeedInstance | null>(null);

  const run = () => {
    if (typeof window === 'undefined' || !window.Speedtest) {
      setStatus('error');
      return;
    }
    setStatus('running');
    setProgress({ dl: 0, ul: 0 });
    const test = new window.Speedtest();
    test.setParameter('telemetry_level', 'none');
    test.addTestPoint({
      name: 'self',
      server: '',
      dlURL: '/api/first-visit/speedtest/download',
      ulURL: '/api/first-visit/speedtest/upload',
      pingURL: '/api/first-visit/speedtest/ping',
      getIpURL: '/api/first-visit/speedtest/ping',
    });
    test.onupdate = (data) => {
      setProgress({ dl: data.dlProgress, ul: data.ulProgress });
    };
    test.onend = (aborted: boolean) => {
      if (aborted) {
        setStatus('error');
        return;
      }
      const dl = Number(test.getState().dlStatus);
      const ul = Number(test.getState().ulStatus);
      if (Number.isFinite(dl) && Number.isFinite(ul)) {
        onResult({ downloadMbps: dl, uploadMbps: ul });
        setStatus('done');
      } else {
        setStatus('error');
      }
    };
    testRef.current = test;
    test.start();
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-gray-200 bg-gray-50 p-3">
      <Script
        src="/vendor/librespeed/speedtest.js"
        strategy="lazyOnload"
        onLoad={() => setStatus((s) => (s === 'loading-script' ? 'ready' : s))}
        onError={() => setStatus('error')}
      />
      <button
        type="button"
        onClick={run}
        disabled={status === 'running' || status === 'loading-script'}
        className="self-start rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {status === 'loading-script'
          ? 'Loading speed test…'
          : status === 'running'
            ? 'Running speed test…'
            : status === 'done'
              ? 'Run again'
              : 'Run speed test'}
      </button>
      {status === 'running' && (
        <p className="text-xs text-gray-500">
          Download {Math.round(progress.dl * 100)}% · Upload {Math.round(progress.ul * 100)}%
        </p>
      )}
      {status === 'error' && (
        <p className="text-xs text-red-600">Speed test failed — check your connection and try again.</p>
      )}
    </div>
  );
}
