'use client';
import { useState } from 'react';
import { VoiceDictationButton } from '@/components/firstVisit/VoiceDictationButton';
import { QuestionRow } from '@/components/firstVisit/StepGroup';
import type { SectionVoiceFill, VoiceFillSummary } from '@/lib/firstVisit/useSectionVoiceFill';
import { voiceSummarySlug, type SectionPrompt } from '@/data/section-voice-prompts';
import { VOICE_FILL_ENABLED } from '@/lib/firstVisit/featureFlags';

// Build the non-intrusive hint shown at the prompt after a clip is processed.
// Just a COUNT of what was filled — listing field names was noisy and leaked the
// synthetic summary slug into the list. The inspector reviews/Accepts the actual
// fields below; the survey deliberately does NOT scroll them away from the prompt.
function summaryLine(s: VoiceFillSummary): string {
  const parts: string[] = [];
  if (s.singlesWritten) parts.push(`${s.singlesWritten} field${s.singlesWritten > 1 ? 's' : ''}`);
  if (s.itemsWritten) parts.push(`${s.itemsWritten} item${s.itemsWritten > 1 ? 's' : ''}`);
  if (parts.length === 0) return 'Nothing to add from that clip — try again or fill below.';
  return `✦ Pre-filled ${parts.join(' + ')} — review & accept below.`;
}

// A single "talk about this" voice prompt, rendered INLINE directly above the
// fields it fills (not bundled at the top of the section). Each clip records →
// AI fills the prompt's mapped fields as Accept-able suggestions in the fields
// just below. The phase-level fill controller is shared across cards (only one
// records at a time); this card is purely presentational and shows feedback
// only when the shared controller is acting on THIS prompt. Renders nothing
// when the feature flag is off.
export function VoicePromptCard({
  prompt,
  phaseId,
  fill,
}: {
  prompt: SectionPrompt;
  phaseId: string;
  fill: SectionVoiceFill;
}) {
  if (!VOICE_FILL_ENABLED) return null;

  const active = fill.activePromptId === prompt.id;
  const btnStatus = active
    ? fill.status === 'thinking'
      ? 'transcribing'
      : fill.status
    : 'idle';

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-indigo-700">
        <span aria-hidden="true">🎙️</span> Fill by voice
      </div>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-700">{prompt.label}</p>
        <div className="shrink-0">
          <VoiceDictationButton
            status={btnStatus}
            online={fill.online}
            elapsedMs={active ? fill.elapsedMs : 0}
            disabled={fill.status !== 'idle' && !active}
            transcribingLabel="Thinking…"
            onStart={() =>
              fill.onStart(
                prompt.id,
                phaseId,
                prompt.target_slugs,
                voiceSummarySlug(prompt.id),
                prompt.qualitative_only ?? false,
              )
            }
            onStop={fill.onStop}
          />
        </div>
      </div>
      {active && (fill.status === 'recording' || fill.status === 'thinking') && fill.interim && (
        <p className="text-xs italic text-gray-500">“{fill.interim}”</p>
      )}
      {fill.summary?.promptId === prompt.id && (
        <div className="flex items-center gap-3">
          <p className="text-xs text-indigo-700">{summaryLine(fill.summary)}</p>
          {fill.canAcceptAll && (
            <button
              type="button"
              onClick={fill.acceptAll}
              className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Accept all
            </button>
          )}
          {fill.accepted && <span className="text-xs text-emerald-700">✓ Accepted</span>}
        </div>
      )}
      {fill.errorPromptId === prompt.id && (
        <p className="text-xs text-amber-700">Voice fill failed — try again or add manually.</p>
      )}
    </div>
  );
}

// The voice-captured summary is a nice-to-have detail, not something that
// should dominate the section — collapse it to a small chip by default and
// only mount the full editable QuestionRow once the inspector taps it.
export function VoiceSummaryChip(props: React.ComponentProps<typeof QuestionRow>) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="self-start rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-200"
      >
        📝 Summary — tap to view
      </button>
    );
  }

  return <QuestionRow {...props} />;
}
