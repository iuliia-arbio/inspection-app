"use client";

import { useState, useRef, useCallback } from "react";

export interface UseVoiceRecorderResult {
  /** Recording state: idle, recording, paused, or has recorded (stopped) */
  status: "idle" | "recording" | "paused" | "recorded";
  /** Elapsed seconds while recording (accumulates across pause/resume) */
  durationSeconds: number;
  /** Recorded audio blob (webm), available after stop */
  blob: Blob | null;
  /** MIME type of the recording (typically audio/webm) */
  mimeType: string | null;
  /** Error message if getUserMedia or recording fails */
  error: string | null;
  /** Start recording. Resolves when started or rejects on error. */
  start: () => Promise<void>;
  /** Pause recording */
  pause: () => void;
  /** Resume from pause */
  resume: () => void;
  /** Stop recording */
  stop: () => void;
  /** Reset to idle and clear blob */
  reset: () => void;
}

export function useVoiceRecorder(): UseVoiceRecorderResult {
  const [status, setStatus] = useState<"idle" | "recording" | "paused" | "recorded">("idle");
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording" || mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    clearTimer();
    setStatus("recorded");
  }, [clearTimer]);

  const pause = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      clearTimer();
      setStatus("paused");
    }
  }, [clearTimer]);

  const resume = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setStatus("recording");
      timerRef.current = setInterval(() => {
        setDurationSeconds((s) => s + 1);
      }, 1000);
    }
  }, []);

  const reset = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording" || mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    clearTimer();
    setStatus("idle");
    setDurationSeconds(0);
    setBlob(null);
    setMimeType(null);
    setError(null);
  }, [clearTimer]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      setMimeType(mime);

      const recorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        if (chunksRef.current.length > 0) {
          setBlob(new Blob(chunksRef.current, { type: mime }));
        }
      };

      recorder.start(100);
      setStatus("recording");
      setDurationSeconds(0);

      timerRef.current = setInterval(() => {
        setDurationSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not access microphone";
      setError(msg);
      setStatus("idle");
      throw err;
    }
  }, []);

  return {
    status,
    durationSeconds,
    blob,
    mimeType,
    error,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
