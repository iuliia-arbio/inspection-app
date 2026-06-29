'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioRecorder } from './useVoiceRecorder';
import { useInterimCaptions } from './useInterimCaptions';
import { postTranscribeAccurate, postVoiceExtraction } from './postVoiceExtraction';
import { buildExtractionSchema } from './extractionSchema';
import { writeAiSuggestions, acceptAiRows, type AiFillResult } from './aiFill';
import type { LocalAnswer } from './db';
import type { HubScope } from './resolveScope';

const MIN_AUDIO_BYTES = 1024;

export type VoiceFillStatus = 'idle' | 'recording' | 'thinking';

export type VoiceFillSummary = {
  promptId: string;
  singlesWritten: number;
  itemsWritten: number;
};

type Options = {
  inspectionId: string;
  targetId: string;
  scope: HubScope;
  ctx: { location_id?: string; unit_category_id?: string };
  /** Reads the latest answers map at write time (for step_index alloc). */
  getAnswers: () => Record<string, LocalAnswer>;
  /** Called with the rows written so the survey can merge them into state. */
  onRowsWritten: (rows: LocalAnswer[]) => void;
};

// Drives one section's voice-fill: record a clip for a chosen prompt → accurate
// transcript → scoped extraction → write suggestions. Only one prompt records at
// a time (activePromptId). Mirrors useVoiceDictation's online/elapsed/serial
// guards; per-word live captions can layer on later via Web Speech.
export function useSectionVoiceFill(opts: Options) {
  const { start, stop } = useAudioRecorder();
  const captions = useInterimCaptions();
  const [status, setStatus] = useState<VoiceFillStatus>('idle');
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [summary, setSummary] = useState<VoiceFillSummary | null>(null);
  const [error, setError] = useState(false);
  // Which prompt's fill errored. Kept separate from `activePromptId` (which is
  // reset to null the moment recording stops) so the failure message can still
  // render against the right prompt AFTER the clip is processed. Without this,
  // a transcribe/extract failure was silently swallowed — the user saw nothing.
  const [errorPromptId, setErrorPromptId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  const areaKeyRef = useRef('');
  const slugsRef = useRef<string[]>([]);
  const summarySlugRef = useRef<string | undefined>(undefined);
  const qualitativeOnlyRef = useRef(false);
  const lastRows = useRef<LocalAnswer[]>([]);
  // Holds the latest onStop so the recorder's silence callback (fired from a
  // closure created at start time) always invokes the current handler.
  const onStopRef = useRef<() => void>(() => {});
  // Re-entrancy guard so a silence auto-stop and a manual stop tap can't both
  // process the same clip.
  const stoppingRef = useRef(false);

  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  }, []);
  useEffect(() => clearTimer, [clearTimer]);

  const onStart = useCallback(
    async (
      promptId: string,
      areaKey: string,
      targetSlugs: string[],
      summarySlug?: string,
      qualitativeOnly = false,
    ) => {
      if (status !== 'idle') return;
      if (!navigator.onLine) return;
      setError(false);
      setErrorPromptId(null);
      setSummary(null);
      setAccepted(false);
      lastRows.current = [];
      areaKeyRef.current = areaKey;
      slugsRef.current = targetSlugs;
      summarySlugRef.current = summarySlug;
      qualitativeOnlyRef.current = qualitativeOnly;
      try {
        // Pass a silence callback so a natural pause auto-finishes the clip
        // (fills the fields) without a manual stop tap.
        await start(() => {
          void onStopRef.current();
        });
        captions.start();
        startedAt.current = Date.now();
        setElapsedMs(0);
        setActivePromptId(promptId);
        setStatus('recording');
        clearTimer();
        timer.current = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 250);
      } catch {
        setStatus('idle');
        setActivePromptId(null);
      }
    },
    [start, captions, clearTimer, status],
  );

  const onStop = useCallback(async () => {
    // Guard against double-processing (silence auto-stop + a manual stop tap).
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    clearTimer();
    captions.stop();
    const promptId = activePromptId;
    const blob = await stop();
    if (!mounted.current) return;
    setStatus('thinking');
    let result: AiFillResult | null = null;
    try {
      if (blob && blob.size >= MIN_AUDIO_BYTES) {
        const text = await postTranscribeAccurate(blob);
        if (text.trim()) {
          const targetSlugs = slugsRef.current;
          const extraction = await postVoiceExtraction(text.trim(), targetSlugs);
          const { groupSlugsByGroup } = buildExtractionSchema(targetSlugs);
          result = await writeAiSuggestions({
            inspectionId: opts.inspectionId,
            targetId: opts.targetId,
            areaKey: areaKeyRef.current,
            scope: opts.scope,
            ctx: opts.ctx,
            extraction,
            answers: opts.getAnswers(),
            groupSlugsByGroup,
            summarySlug: summarySlugRef.current,
            writeStructured: !qualitativeOnlyRef.current,
          });
          if (mounted.current) {
            lastRows.current = result.writtenRows;
            opts.onRowsWritten(result.writtenRows);
          }
        }
      }
      if (mounted.current && promptId) {
        setSummary({
          promptId,
          singlesWritten: result?.singlesWritten ?? 0,
          itemsWritten: result?.itemsWritten ?? 0,
        });
      }
    } catch {
      if (mounted.current) {
        setError(true);
        setErrorPromptId(promptId);
      }
    } finally {
      stoppingRef.current = false;
      if (mounted.current) {
        setStatus('idle');
        setActivePromptId(null);
      }
    }
  }, [stop, captions, clearTimer, activePromptId, opts]);

  // Keep the silence callback pointed at the current onStop.
  useEffect(() => {
    onStopRef.current = onStop;
  }, [onStop]);

  const acceptAll = useCallback(async () => {
    const updated = await acceptAiRows(lastRows.current);
    if (updated.length && mounted.current) {
      opts.onRowsWritten(updated);
      setAccepted(true);
    }
  }, [opts]);

  const canAcceptAll =
    status === 'idle' && !accepted && summary !== null && summary.singlesWritten + summary.itemsWritten > 0;

  return {
    status,
    activePromptId,
    online,
    elapsedMs,
    summary,
    error,
    errorPromptId,
    accepted,
    canAcceptAll,
    interim: captions.interim,
    onStart,
    onStop,
    acceptAll,
  };
}

// The full fill controller returned by useSectionVoiceFill. Consumers (the
// inline VoicePromptCard) receive this so a single phase-level hook can drive
// every prompt card co-located with its fields.
export type SectionVoiceFill = ReturnType<typeof useSectionVoiceFill>;
