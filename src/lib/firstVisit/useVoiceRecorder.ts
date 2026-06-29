'use client';
import { useRef, useState, useCallback } from 'react';

// Pause-to-finish tuning. Above SPEECH_RMS counts as speaking; once the
// inspector HAS spoken and then stays below it for SILENCE_MS, we treat the clip
// as finished and fire the onSilence callback so they don't have to tap stop.
const SPEECH_RMS = 0.018;
const SILENCE_MS = 1800;

export function useAudioRecorder() {
  const [recording, setRecording] = useState(false);
  const chunks = useRef<Blob[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const silenceCleanup = useRef<(() => void) | null>(null);

  // `onSilence` (optional): called once when the inspector pauses after speaking,
  // so the caller can auto-stop+process. Feature-detected and fully guarded — on
  // any failure we silently fall back to manual stop (no auto behaviour).
  const start = useCallback(async (onSilence?: () => void) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const r = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    chunks.current = [];
    r.ondataavailable = (e) => chunks.current.push(e.data);
    r.start();
    recorder.current = r;
    setRecording(true);

    silenceCleanup.current = null;
    if (!onSilence) return;
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ac = new AC();
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let spoke = false;
      let silentSince: number | null = null;
      let raf = 0;
      let done = false;

      const cleanup = () => {
        done = true;
        cancelAnimationFrame(raf);
        try {
          src.disconnect();
        } catch {
          /* already torn down */
        }
        void ac.close().catch(() => {});
        silenceCleanup.current = null;
      };

      const tick = () => {
        if (done) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const x = (buf[i] - 128) / 128;
          sum += x * x;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (rms > SPEECH_RMS) {
          spoke = true;
          silentSince = null;
        } else if (spoke) {
          if (silentSince == null) silentSince = now;
          else if (now - silentSince > SILENCE_MS) {
            cleanup();
            onSilence();
            return;
          }
        }
        raf = requestAnimationFrame(tick);
      };

      silenceCleanup.current = cleanup;
      raf = requestAnimationFrame(tick);
    } catch {
      silenceCleanup.current = null;
    }
  }, []);

  const stop = useCallback(async (): Promise<Blob | null> => {
    if (silenceCleanup.current) silenceCleanup.current();
    const r = recorder.current;
    if (!r) return null;
    return new Promise((resolve) => {
      r.onstop = () => {
        setRecording(false);
        r.stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks.current, { type: 'audio/webm' }));
      };
      r.stop();
    });
  }, []);

  return { recording, start, stop };
}
