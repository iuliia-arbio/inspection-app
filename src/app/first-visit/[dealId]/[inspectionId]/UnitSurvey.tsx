'use client';
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  CheckIcon,
} from '@/components/icons';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  filterPhasesForScope,
  areaKeyFor,
  groupIdFor,
  isScopeLevelRequired,
  buildAnchorMap,
  filterOutAnchored,
  isVisible,
  type FirstVisitQuestion,
} from '@/lib/firstVisit/questions';
import { useSurveyConfig } from '@/lib/firstVisit/SurveyConfigContext';
import {
  MISSING_REQUIRED_TEXT,
  missingBorderCls,
  RepeaterStub,
} from '@/components/firstVisit/PrefilledField';
import { MediaButtons } from '@/components/firstVisit/MediaButtons';
import { AttachAffordance } from '@/components/firstVisit/AttachAffordance';
import { CopyFromUnitTrigger } from '@/components/firstVisit/CopyFromUnitTrigger';
import { ProgressRing } from '@/components/firstVisit/ProgressRing';
import { StepGroup, QuestionRow } from '@/components/firstVisit/StepGroup';
import { localDb, type LocalAnswer } from '@/lib/firstVisit/db';
import { enqueue } from '@/lib/firstVisit/sync';
import {
  resolveScopeId,
  scopeLabel,
  type HubScope,
  type InspectionScopeContext,
} from '@/lib/firstVisit/resolveScope';
import { lookupHubValue, type HubSnapshot } from '@/lib/firstVisit/snapshot';
import { repeaterGroupMeta } from '@/lib/firstVisit/repeaterGroups';
import { isAnsweredValueOrMedia, requiredVisible } from '@/lib/firstVisit/progress';
import { track } from '@/lib/firstVisit/analytics';
import { VoicePromptCard, VoiceSummaryChip } from '@/components/firstVisit/SectionVoicePrompts';
import { WifiSpeedTest } from '@/components/firstVisit/WifiSpeedTest';
import { useSectionVoiceFill } from '@/lib/firstVisit/useSectionVoiceFill';
import { promptsForPhase, voiceSummarySlug } from '@/data/section-voice-prompts';
import { isAiSnapshot, unwrapAiSnapshot } from '@/lib/firstVisit/aiFill';

// A target the survey is rendering for. The deal-scoped visit root is a
// synthetic target whose id === inspectionId.
export type SurveyTarget = {
  id: string;
  label: string;
};

export function UnitSurvey({
  inspectionId,
  target,
  scope,
  ctx,
  snapshot,
  onBack,
  breadcrumb,
  phaseIds,
  submitAttempt,
}: {
  inspectionId: string;
  target: SurveyTarget;
  scope: HubScope;
  ctx: InspectionScopeContext;
  snapshot: HubSnapshot | null;
  onBack: () => void;
  breadcrumb?: string[];
  phaseIds?: string[];
  // Batch E1: number of submit attempts so far this session (0/undefined =
  // none; state lives in VisitNavigator and persists for the session). Any
  // attempt escalates the missing-required cue from a subtle amber hint to
  // red + aria-invalid and flags section chips with outstanding required
  // questions; each NEW attempt additionally auto-navigates this survey to
  // the first phase that still has missing required work — exactly once per
  // attempt (the counter is consumed, so re-renders and chip taps never yank
  // the inspector back).
  submitAttempt?: number;
}) {
  const submitAttempted = (submitAttempt ?? 0) > 0;
  const { phases: configPhases } = useSurveyConfig();
  const [answers, setAnswers] = useState<Record<string, LocalAnswer>>({});
  // Keys of fields just populated by a voice fill — drives the transient
  // sparkle icon highlight ("from voice"); cleared after a short delay.
  const [justFilledKeys, setJustFilledKeys] = useState<Set<string>>(new Set());
  // WS-F media anchoring: pull photo/video file-questions out of their own
  // phase ("Property documentation", "Unit photos & videos") and inline them
  // under their related data question. We build the map across the whole
  // scope so an anchor in phase A can pull a file-question that was originally
  // in phase B.
  const phases = useMemo(() => {
    const raw = filterPhasesForScope(configPhases, scope, phaseIds);
    const allInScope = raw.flatMap((p) => p.questions);
    const anchorMap = buildAnchorMap(allInScope);
    const anchoredSlugs = new Set<string>();
    for (const arr of anchorMap.values()) {
      for (const q of arr) anchoredSlugs.add(q.slug);
    }
    return filterOutAnchored(raw, anchoredSlugs);
  }, [configPhases, scope, phaseIds]);
  const anchorMap = useMemo(() => {
    const allInScope = filterPhasesForScope(configPhases, scope, phaseIds).flatMap(
      (p) => p.questions,
    );
    return buildAnchorMap(allInScope);
  }, [configPhases, scope, phaseIds]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const activeChipRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const didMountRef = useRef(false);

  useEffect(() => {
    (async () => {
      const rows = await localDb.answers
        .where('target_id')
        .equals(target.id)
        .toArray();
      const map: Record<string, LocalAnswer> = {};
      for (const r of rows) {
        const base = `${r.target_id}::${r.area_key}::${r.question_key}`;
        // Repeater-aware answers (step_index set) get a step-suffixed key so
        // multiple blocks of the same group don't collide in the map. Single-
        // instance answers keep the legacy 3-part key.
        const key = r.step_index == null ? base : `${base}::${r.step_index}`;
        map[key] = r;
      }
      setAnswers(map);
    })();
  }, [target.id]);

  // Reset to first section when switching targets.
  useEffect(() => {
    setCurrentIdx(0);
  }, [target.id]);

  // Media-answered question keys for this target. Photo/video capture writes
  // only the media table — no answer row exists — so required file questions
  // count as done through this set (see progress.ts). Kept live via the
  // media-table hooks so a capture ticks the ring immediately (same pattern
  // as MediaGallery). LOCAL rows only: a cloud-restored device has no blobs,
  // so its file questions read as missing — known limitation.
  const [mediaKeys, setMediaKeys] = useState<Set<string>>(new Set());
  const [mediaRev, setMediaRev] = useState(0);
  useEffect(() => {
    const bump = () => setMediaRev((r) => r + 1);
    localDb.media.hook('creating', bump);
    localDb.media.hook('deleting', bump);
    return () => {
      localDb.media.hook('creating').unsubscribe(bump);
      localDb.media.hook('deleting').unsubscribe(bump);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await localDb.media
        .where('inspection_id')
        .equals(inspectionId)
        .toArray();
      if (!alive) return;
      const keys = new Set<string>();
      for (const m of rows) {
        if (m.target_id === target.id && m.question_key) keys.add(m.question_key);
      }
      setMediaKeys(keys);
    })();
    return () => {
      alive = false;
    };
  }, [inspectionId, target.id, mediaRev]);

  // Keep the active section chip visible in the strip when it changes, and
  // bring the new section header into view on the page itself. Skip on first
  // mount so we don't snap the page on initial load.
  useEffect(() => {
    activeChipRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [currentIdx]);

  const onChange = async (
    q: FirstVisitQuestion,
    next: { value: unknown; wasAcceptedAsIs: boolean },
    stepIndex: number | null = null,
    syntheticQuestionKey?: string,
  ) => {
    const areaKey = areaKeyFor(q);
    // syntheticQuestionKey lets the renderer route follow-up answers
    // (`${slug}__follow_up`, `${slug}__per_option__${slug(opt)}`) into the
    // same answers table without minting a question on the JSON config.
    const questionKey = syntheticQuestionKey ?? q.slug;
    const baseKey = `${target.id}::${areaKey}::${questionKey}`;
    const key = stepIndex == null ? baseKey : `${baseKey}::${stepIndex}`;
    const now = new Date().toISOString();
    const existing = answers[key];
    const row: LocalAnswer = {
      id: existing?.id ?? crypto.randomUUID(),
      inspection_id: inspectionId,
      target_id: target.id,
      scope,
      location_id: ctx.location_id,
      unit_category_id: ctx.unit_category_id,
      question_key: questionKey,
      area_key: areaKey,
      step_index: stepIndex,
      value: next.value,
      // Preserve any note attached via setNotes — this row literal replaces the
      // whole Dexie object, so omitting notes would silently destroy it.
      notes: existing?.notes,
      data_point_slug: questionKey,
      hub_suggestion_snapshot: existing?.hub_suggestion_snapshot,
      was_prefilled: !!existing?.was_prefilled,
      was_accepted_as_is: next.wasAcceptedAsIs,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await localDb.answers.put(row);
    track('answer_saved', { question_key: questionKey, inspection_id: inspectionId });
    setAnswers((a) => ({ ...a, [key]: row }));
    await enqueue('answer_upsert', row);
  };

  // Update just the notes field on an answer row without touching value /
  // wasAcceptedAsIs. Creates a stub answer row if none exists yet so the note
  // survives across sessions even before the inspector picks a value.
  const setNotes = async (
    q: FirstVisitQuestion,
    nextNotes: string,
    stepIndex: number | null = null,
  ) => {
    const areaKey = areaKeyFor(q);
    const baseKey = `${target.id}::${areaKey}::${q.slug}`;
    const key = stepIndex == null ? baseKey : `${baseKey}::${stepIndex}`;
    const now = new Date().toISOString();
    const existing = answers[key];
    const row: LocalAnswer = {
      id: existing?.id ?? crypto.randomUUID(),
      inspection_id: inspectionId,
      target_id: target.id,
      scope,
      location_id: ctx.location_id,
      unit_category_id: ctx.unit_category_id,
      question_key: q.slug,
      area_key: areaKey,
      step_index: stepIndex,
      value: existing?.value ?? null,
      notes: nextNotes,
      data_point_slug: q.slug,
      hub_suggestion_snapshot: existing?.hub_suggestion_snapshot,
      was_prefilled: !!existing?.was_prefilled,
      was_accepted_as_is: !!existing?.was_accepted_as_is,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await localDb.answers.put(row);
    setAnswers((a) => ({ ...a, [key]: row }));
    await enqueue('answer_upsert', row);
  };

  // Copy answers from another unit in this same visit onto the current unit,
  // scoped to one section (phase) at a time — pass questionKeys to copy only
  // the hand-picked subset, or omit it to copy every meaningful answer this
  // phase has on the source unit. Skips media, hub-suggestion snapshots, and
  // skipped sentinel values. If the target already has answers in this phase,
  // asks for confirmation.
  const copyAnswersFromUnitForPhase = async (
    sourceUnitId: string,
    phaseId: string,
    questionKeys?: string[],
  ) => {
    if (scope !== 'unit_category') return;
    const sourceRows = await localDb.answers
      .where('target_id')
      .equals(sourceUnitId)
      .toArray();
    const meaningful = sourceRows.filter(
      (r) =>
        r.area_key === phaseId &&
        r.value !== null &&
        r.value !== undefined &&
        r.value !== '' &&
        (!questionKeys || questionKeys.includes(r.question_key)),
    );
    if (meaningful.length === 0) {
      alert('That unit has no answers to copy in this section yet.');
      return;
    }

    const targetExisting = await localDb.answers
      .where('target_id')
      .equals(target.id)
      .toArray();
    const targetHasAny = targetExisting.some(
      (r) => r.area_key === phaseId && r.value !== null && r.value !== undefined && r.value !== '',
    );
    if (targetHasAny) {
      const ok = confirm(
        'This section already has answers. Replace them with the copied values?',
      );
      if (!ok) return;
    }

    const now = new Date().toISOString();
    const indexByKey = new Map<string, LocalAnswer>();
    for (const r of targetExisting) {
      indexByKey.set(`${r.area_key}::${r.question_key}`, r);
    }

    let copied = 0;
    for (const src of meaningful) {
      const existing = indexByKey.get(`${src.area_key}::${src.question_key}`);
      const row: LocalAnswer = {
        id: existing?.id ?? crypto.randomUUID(),
        inspection_id: inspectionId,
        target_id: target.id,
        scope,
        location_id: ctx.location_id,
        unit_category_id: ctx.unit_category_id,
        question_key: src.question_key,
        area_key: src.area_key,
        value: src.value,
        notes: src.notes,
        data_point_slug: src.data_point_slug,
        // Don't carry the source unit's hub-suggestion snapshot onto the target —
        // the target may have its own hub data the inspector still needs to
        // accept/decline. Keep the existing snapshot if any.
        hub_suggestion_snapshot: existing?.hub_suggestion_snapshot,
        was_prefilled: false,
        was_accepted_as_is: false,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      await localDb.answers.put(row);
      await enqueue('answer_upsert', row);
      copied++;
    }

    track('unit_answers_copied', {
      source: sourceUnitId,
      target: target.id,
      phase: phaseId,
      count: copied,
    });

    // Refresh in-memory map from Dexie so the UI reflects the copies.
    const fresh = await localDb.answers
      .where('target_id')
      .equals(target.id)
      .toArray();
    const map: Record<string, LocalAnswer> = {};
    for (const r of fresh) map[`${r.target_id}::${r.area_key}::${r.question_key}`] = r;
    setAnswers(map);
  };

  const scopeId = resolveScopeId(scope, ctx) ?? undefined;

  // Conditional branching (visible_when). Map every single-instance answer's
  // controlling-question slug → its current value so isVisible() can evaluate a
  // dependent's rule. Rebuilt each render from the live answers map. Repeater
  // (step-indexed) answers are excluded — branching controllers are
  // single-instance questions.
  // A controller's confirmed value wins; but an UNCONFIRMED voice suggestion
  // (value:null, snapshot holds the proposed value) still reveals its dependent
  // fields. Otherwise a voice-filled gate (e.g. "Elevator present? → Yes") would
  // stay closed — burying its suggestions behind a collapsed section — until the
  // inspector manually Accepted the gate. The dependents render with their own
  // Accept-able suggestions; clearing/rejecting the gate re-hides them.
  const valueByKey = useMemo(() => {
    const m = new Map<string, unknown>();
    for (const a of Object.values(answers)) {
      if (a.target_id !== target.id) continue;
      if (a.step_index != null) continue;
      if (a.value != null) {
        m.set(a.question_key, a.value);
      } else if (isAiSnapshot(a.hub_suggestion_snapshot)) {
        m.set(a.question_key, unwrapAiSnapshot(a.hub_suggestion_snapshot));
      } else {
        m.set(a.question_key, a.value);
      }
    }
    return m;
  }, [answers, target.id]);

  // When a controller answer changes such that a previously-answered dependent
  // becomes hidden, clear the dependent's stored value so stale data is never
  // submitted. Self-healing: keyed on the answers map, so it fires no matter
  // which path wrote the controller. Reuses the onChange autosave path (Dexie
  // put + enqueue) by writing value:null for each hidden, non-empty dependent
  // across the whole scope (not just the visible phase).
  const allScopeQuestions = useMemo(
    () => filterPhasesForScope(configPhases, scope, phaseIds).flatMap((p) => p.questions),
    [configPhases, scope, phaseIds],
  );
  useEffect(() => {
    const toClear: FirstVisitQuestion[] = [];
    for (const q of allScopeQuestions) {
      if (!q.visible_when) continue;
      if (isVisible(q.visible_when, valueByKey)) continue;
      const key = `${target.id}::${areaKeyFor(q)}::${q.slug}`;
      const v = answers[key]?.value;
      if (v === null || v === undefined || v === '') continue;
      toClear.push(q);
    }
    if (toClear.length === 0) return;
    for (const q of toClear) {
      void onChange(q, { value: null, wasAcceptedAsIs: false });
    }
    // onChange is stable enough here; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueByKey, allScopeQuestions, answers, target.id]);

  // Resolve the "Pre-filled" banner value for a field: an unconfirmed AI voice
  // suggestion (stored on the answer row's snapshot) takes precedence, falling
  // back to the hub snapshot. Step-aware so AI-filled repeater rows resolve too.
  const aiOrHubValue = (areaKey: string, slug: string, stepIndex: number | null) => {
    const key =
      stepIndex == null
        ? `${target.id}::${areaKey}::${slug}`
        : `${target.id}::${areaKey}::${slug}::${stepIndex}`;
    const snap = answers[key]?.hub_suggestion_snapshot;
    if (isAiSnapshot(snap)) {
      const v = unwrapAiSnapshot(snap);
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return snapshot ? lookupHubValue(snapshot, scopeId, slug) : undefined;
  };

  const rowKey = (r: LocalAnswer) =>
    r.step_index == null
      ? `${r.target_id}::${r.area_key}::${r.question_key}`
      : `${r.target_id}::${r.area_key}::${r.question_key}::${r.step_index}`;

  // Merge AI-written suggestion rows into the in-memory answers map so the
  // fields re-render with their "Pre-filled / Accept" banners immediately, and
  // briefly flag them as just-filled for the highlight.
  const mergeAiRows = (rows: LocalAnswer[]) => {
    if (rows.length === 0) return;
    const keys = rows.map(rowKey);
    setAnswers((a) => {
      const next = { ...a };
      for (let i = 0; i < rows.length; i++) next[keys[i]] = rows[i];
      return next;
    });
    setJustFilledKeys(new Set(keys));
    // Deliberately NO auto-scroll: the inspector keeps talking through the
    // section and reviews/accepts the suggestions further down whenever they
    // choose. The fill is signalled in place by the prompt's "Pre-filled: …"
    // hint plus the transient sparkle-icon highlight on each field.
    setTimeout(() => setJustFilledKeys(new Set()), 2500);
  };

  // Phase-level voice-fill controller. One instance drives every prompt card in
  // the current phase (only one records at a time); cards are co-located with
  // their fields below via VoicePromptCard. area_key is passed per onStart call
  // (the phase id), so a single hook serves whichever phase is on screen.
  const voiceFill = useSectionVoiceFill({
    inspectionId,
    targetId: target.id,
    scope,
    ctx,
    getAnswers: () => answers,
    onRowsWritten: mergeAiRows,
  });


  const isJustFilled = (areaKey: string, slug: string, stepIndex: number | null) => {
    const key =
      stepIndex == null
        ? `${target.id}::${areaKey}::${slug}`
        : `${target.id}::${areaKey}::${slug}::${stepIndex}`;
    return justFilledKeys.has(key);
  };

  // Batch E1: per-field missing-required state. "Missing" = scope-level
  // required && not answered (value or media). Visibility is enforced by the
  // render path itself — hidden questions never reach the renderer — so only
  // rendered questions are ever checked. Cheap: everything is already in
  // memory. Subtle while the inspector works; strong after a submit attempt.
  const missingFor = (q: FirstVisitQuestion): 'subtle' | 'strong' | undefined => {
    if (!isScopeLevelRequired(q)) return undefined;
    const key = `${target.id}::${areaKeyFor(q)}::${q.slug}`;
    if (isAnsweredValueOrMedia(q, answers[key]?.value, mediaKeys)) return undefined;
    return submitAttempted ? 'strong' : 'subtle';
  };

  // Progress across the whole scope: required answered / required total.
  // Anchored file-questions render inside another phase but still count
  // toward the anchor's phase progress (they no longer have a phase of their
  // own once "Property documentation" / "Unit photos & videos" empty out).
  const allAnchoredInScope = useMemo(
    () => Array.from(anchorMap.values()).flat(),
    [anchorMap],
  );
  const requiredStats = useMemo(() => {
    const inPhases = phases.flatMap((p) => p.questions);
    // Required AND currently visible: a hidden required dependent must not keep
    // the ring from reaching 100% (mirrors progress.ts requiredVisible).
    const required = requiredVisible([...inPhases, ...allAnchoredInScope], valueByKey);
    const done = required.filter((q) => {
      const key = `${target.id}::${areaKeyFor(q)}::${q.slug}`;
      // File questions are answered by captured media, not an answer row.
      return isAnsweredValueOrMedia(q, answers[key]?.value, mediaKeys);
    }).length;
    return { done, total: required.length };
  }, [phases, allAnchoredInScope, answers, target.id, valueByKey, mediaKeys]);

  // Index of the next phase that has a required, unanswered question, searching
  // from currentIdx + 1 forward, then wrapping to 0..currentIdx. Returns null
  // when every required question across all phases is already answered.
  // Anchored file-questions are folded into their anchor's phase here so
  // skipping forward considers them too.
  const anchoredByAnchorPhase = useMemo(() => {
    const m = new Map<string, FirstVisitQuestion[]>();
    for (const p of phases) {
      const list: FirstVisitQuestion[] = [];
      for (const q of p.questions) {
        const a = anchorMap.get(q.slug);
        if (a) list.push(...a);
      }
      if (list.length > 0) m.set(p.id, list);
    }
    return m;
  }, [phases, anchorMap]);
  const nextIncompletePhaseIdx = useMemo(() => {
    const phaseHasIncomplete = (p: (typeof phases)[number]) => {
      const own = p.questions;
      const anchored = anchoredByAnchorPhase.get(p.id) ?? [];
      // Only visible required questions block completion — a hidden required
      // dependent must not make a phase look perpetually incomplete.
      return requiredVisible([...own, ...anchored], valueByKey).some((q) => {
        const key = `${target.id}::${areaKeyFor(q)}::${q.slug}`;
        return !isAnsweredValueOrMedia(q, answers[key]?.value, mediaKeys);
      });
    };
    for (let i = currentIdx + 1; i < phases.length; i++) {
      if (phaseHasIncomplete(phases[i])) return i;
    }
    for (let i = 0; i <= currentIdx; i++) {
      if (phaseHasIncomplete(phases[i])) return i;
    }
    return null;
  }, [phases, anchoredByAnchorPhase, answers, target.id, currentIdx, valueByKey, mediaKeys]);

  // Batch E1 follow-up: guide to the first missing section. When a survey
  // opens (or re-keys to a new target) after a submit attempt, jump to the
  // FIRST phase that still has visible required work. Once per attempt: the
  // attempt counter is consumed via lastJumpedAttemptRef, so re-renders and
  // manual chip navigation never yank the inspector back. Reads Dexie
  // directly (not the answers/mediaKeys state) so a fresh mount can't
  // mis-jump before the async state loads; fully-answered surveys stay put.
  const lastJumpedAttemptRef = useRef(0);
  useEffect(() => {
    const attempt = submitAttempt ?? 0;
    if (attempt === 0 || lastJumpedAttemptRef.current >= attempt) return;
    lastJumpedAttemptRef.current = attempt;
    let alive = true;
    (async () => {
      const [answerRows, mediaRows] = await Promise.all([
        localDb.answers.where('target_id').equals(target.id).toArray(),
        localDb.media.where('inspection_id').equals(inspectionId).toArray(),
      ]);
      if (!alive) return;
      const mediaSlugSet = new Set<string>();
      for (const m of mediaRows) {
        if (m.target_id === target.id && m.question_key) {
          mediaSlugSet.add(m.question_key);
        }
      }
      // Single-instance slug → value map; enough for both visibility and the
      // answered check (repeater members are never scope-level required).
      const valueBySlug = new Map<string, unknown>();
      for (const r of answerRows) {
        if (r.step_index == null) valueBySlug.set(r.question_key, r.value);
      }
      const idx = phases.findIndex((p) => {
        const anchored = anchoredByAnchorPhase.get(p.id) ?? [];
        return requiredVisible([...p.questions, ...anchored], valueBySlug).some(
          (q) => !isAnsweredValueOrMedia(q, valueBySlug.get(q.slug), mediaSlugSet),
        );
      });
      if (idx >= 0) setCurrentIdx(idx);
    })();
    return () => {
      alive = false;
    };
  }, [submitAttempt, phases, anchoredByAnchorPhase, target.id, inspectionId]);

  if (phases.length === 0) {
    return (
      <main className="mx-auto max-w-md p-6">
        <button
          onClick={onBack}
          tabIndex={-1}
          className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 min-h-[44px]"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Back to visit
        </button>
        <h1 className="text-lg font-semibold">{target.label}</h1>
        <p className="mt-6 text-sm text-gray-500">
          No questions configured for this scope yet.
        </p>
      </main>
    );
  }

  const phase = phases[currentIdx];
  const isFirst = currentIdx === 0;
  const isLast = currentIdx === phases.length - 1;

  // Co-locate each voice prompt with its fields: anchor it to the FIRST of its
  // target slugs present in this phase, so the prompt's mic renders inline
  // directly above the questions it fills (not bundled at the top of the
  // section). The phase content is ordered so a prompt's targets are contiguous.
  const phasePrompts = promptsForPhase(phase.id);
  const promptByAnchorSlug = new Map<string, (typeof phasePrompts)[number]>();
  {
    const phaseSlugs = new Set(phase.questions.map((q) => q.slug));
    for (const p of phasePrompts) {
      const anchor = p.target_slugs.find((s) => phaseSlugs.has(s));
      if (anchor && !promptByAnchorSlug.has(anchor)) promptByAnchorSlug.set(anchor, p);
    }
  }
  // Synthesize a text "question" for a prompt's qualitative voice summary so it
  // renders through the normal QuestionRow text path (caret-safe editing +
  // external-sync when voice writes it). slug = the synthetic summary key.
  const summaryQuestionFor = (promptId: string): FirstVisitQuestion => ({
    slug: voiceSummarySlug(promptId),
    label: 'Summary (from voice)',
    description: 'Editable recap captured from your voice clip — correct anything as needed.',
    scope,
    mode: 'observe',
    type: 'text',
    options: [],
    required: false,
    repeater: false,
    pms_target: null,
    status: 'existing',
    verdict: null,
    notes: null,
    phase_id: phase.id,
    phase_label: phase.label,
  });
  const voiceCardFor = (slugs: string[]) => {
    for (const s of slugs) {
      const p = promptByAnchorSlug.get(s);
      if (p) {
        const sq = summaryQuestionFor(p.id);
        const summaryAnswer = answers[`${target.id}::${phase.id}::${sq.slug}`];
        const hasSummary =
          summaryAnswer?.value != null && String(summaryAnswer.value).trim() !== '';
        return (
          <Fragment key={`vp-${p.id}`}>
            <VoicePromptCard prompt={p} phaseId={phase.id} fill={voiceFill} />
            {hasSummary && (
              <VoiceSummaryChip
                question={sq}
                inspectionId={inspectionId}
                targetId={target.id}
                areaKey={phase.id}
                stepIndex={null}
                hubValue={undefined}
                justFilled={isJustFilled(phase.id, sq.slug, null)}
                answers={answers}
                onChange={onChange}
                setNotes={setNotes}
              />
            )}
          </Fragment>
        );
      }
    }
    return null;
  };

  return (
    <main className="mx-auto max-w-md p-6 pb-24">
      <button
        onClick={onBack}
        tabIndex={-1}
        className="mb-1 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 min-h-[44px]"
      >
        <ArrowLeftIcon className="h-4 w-4" /> Back to visit
      </button>
      {breadcrumb && breadcrumb.length > 1 && (
        // Show only the parent context — the last item duplicates the H1.
        // For property scope the breadcrumb is single-item, so nothing renders.
        <div className="mb-3 text-xs text-gray-400">
          {breadcrumb.slice(0, -1).map((crumb, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1 text-gray-300"><ChevronRightIcon className="inline h-3 w-3 text-gray-300" /></span>}
              <span>{crumb}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <h1 className="text-lg font-semibold">{target.label}</h1>
        <ProgressRing done={requiredStats.done} total={requiredStats.total} />
      </div>

      {/* Sticky horizontal section strip */}
      <div className="sticky top-0 z-10 -mx-6 mt-3 bg-white px-6 pb-2 pt-1">
        <div
          ref={stripRef}
          className="flex gap-1.5 overflow-x-auto whitespace-nowrap pb-1"
          style={{ scrollbarWidth: 'none' }}
        >
          {phases.map((p, i) => {
            const active = i === currentIdx;
            // Section completion dot: any required question done for this phase.
            // Include anchored file-questions that render inside this phase.
            const anchoredHere = anchoredByAnchorPhase.get(p.id) ?? [];
            const reqInPhase = [...p.questions, ...anchoredHere].filter(
              isScopeLevelRequired,
            );
            const doneInPhase = reqInPhase.filter((q) => {
              const key = `${target.id}::${areaKeyFor(q)}::${q.slug}`;
              return isAnsweredValueOrMedia(q, answers[key]?.value, mediaKeys);
            }).length;
            const phaseComplete = reqInPhase.length > 0 && doneInPhase === reqInPhase.length;
            // E1: after a submit attempt, flag sections with outstanding
            // VISIBLE required questions (requiredVisible keeps a hidden
            // required dependent from flagging a section forever).
            const missingInPhase = submitAttempted
              ? requiredVisible([...p.questions, ...anchoredHere], valueByKey).filter(
                  (q) => {
                    const key = `${target.id}::${areaKeyFor(q)}::${q.slug}`;
                    return !isAnsweredValueOrMedia(q, answers[key]?.value, mediaKeys);
                  },
                ).length
              : 0;

            return (
              <button
                key={p.id}
                ref={active ? activeChipRef : undefined}
                onClick={() => setCurrentIdx(i)}
                tabIndex={-1}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                  active
                    ? 'bg-black text-white'
                    : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span>{p.label}</span>
                <span
                  aria-hidden
                  className={`text-[10px] tabular-nums ${
                    active ? 'text-white/70' : 'text-gray-400'
                  }`}
                >
                  {p.questions.length + anchoredHere.length}
                </span>
                {phaseComplete && (
                  <span
                    aria-hidden
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      active ? 'bg-white' : 'bg-emerald-500'
                    }`}
                  />
                )}
                {missingInPhase > 0 && (
                  <span
                    aria-hidden
                    data-testid={`chip-missing-${p.id}`}
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      active ? 'bg-red-300' : 'bg-red-500'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section key={phase.id} ref={sectionRef} className="mt-4 scroll-mt-20">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium uppercase tracking-wide text-gray-500">
              {phase.label}
            </div>
            <span className="w-fit rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
              {scopeLabel(scope)}
            </span>
          </div>
          {scope === 'unit_category' && (
            <CopyFromUnitTrigger
              inspectionId={inspectionId}
              currentUnitId={target.id}
              phaseId={phase.id}
              phaseQuestions={phase.questions.map((q) => ({ slug: q.slug, label: q.label }))}
              onCopy={(sourceUnitId, questionKeys) =>
                copyAnswersFromUnitForPhase(sourceUnitId, phase.id, questionKeys)
              }
            />
          )}
        </div>
        <div className="mt-3 flex flex-col gap-3">
          {buildRenderPlan(phase.questions).map((node) => {
            if (node.kind === 'group') {
              // Conditional branching: if every question in the block is hidden
              // (e.g. its gate controller is off), skip the whole block.
              const visibleGroupQs = node.questions.filter((gq) =>
                isVisible(gq.visible_when, valueByKey),
              );
              if (visibleGroupQs.length === 0) return null;
              // Anchored children for any question in the group are rendered
              // after the group block (groups don't slice file-questions
              // mid-block; the StepGroup owns its own layout).
              const groupAnchored = node.questions.flatMap(
                (gq) => anchorMap.get(gq.slug) ?? [],
              );
              const groupMeta = repeaterGroupMeta(node.groupId);
              return (
                <Fragment key={`group-${node.groupId}`}>
                  {voiceCardFor(node.questions.map((gq) => gq.slug))}
                  <div className="flex flex-col gap-3">
                  <StepGroup
                    groupId={node.groupId}
                    groupLabel={groupMeta.title}
                    intro={groupMeta.intro}
                    itemNoun={groupMeta.itemNoun}
                    questions={node.questions}
                    inspectionId={inspectionId}
                    targetId={target.id}
                    areaKey={phase.id}
                    hubValueLookup={(slug, stepIndex) =>
                      aiOrHubValue(phase.id, slug, stepIndex)
                    }
                    justFilledLookup={(slug, stepIndex) =>
                      isJustFilled(phase.id, slug, stepIndex)
                    }
                    answers={answers}
                    onChange={onChange}
                    setNotes={setNotes}
                  />
                  {groupAnchored.map((fq) =>
                    renderAnchoredFile(fq, {
                      inspectionId,
                      targetId: target.id,
                      areaKey: phase.id,
                      answers,
                      setNotes,
                    }),
                  )}
                  </div>
                </Fragment>
              );
            }

            const q = node.question;
            // Conditional branching: skip a question whose visible_when rule is
            // not satisfied. Its anchored media children render inside this
            // branch, so they are skipped along with it.
            if (!isVisible(q.visible_when, valueByKey)) return null;
            const key = `${target.id}::${areaKeyFor(q)}::${q.slug}`;
            const answer = answers[key];
            const anchored = anchorMap.get(q.slug) ?? [];

            if (q.type === 'repeater') {
              return (
                <Fragment key={key}>
                  {voiceCardFor([q.slug])}
                  <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <RepeaterStub
                      question={q}
                      value={answer?.value}
                      onChange={(c) => onChange(q, c)}
                    />
                    <AttachAffordance
                      inspectionId={inspectionId}
                      targetId={target.id}
                      areaKey={phase.id}
                      questionKey={q.slug}
                      answerId={answer?.id}
                      notes={answer?.notes}
                      onNotesChange={(n) => setNotes(q, n)}
                    />
                  </div>
                  {anchored.map((fq) =>
                    renderAnchoredFile(fq, {
                      inspectionId,
                      targetId: target.id,
                      areaKey: phase.id,
                      answers,
                      setNotes,
                    }),
                  )}
                  </div>
                </Fragment>
              );
            }

            if (q.type === 'file') {
              // Missing-required cue on the capture container: the required
              // file slugs are the most-skipped fields, so they get the same
              // amber/red treatment as inputs (plus the non-color-only helper
              // text when strong). Media counts as answered via missingFor.
              const fileMissing = missingFor(q);
              return (
                <Fragment key={key}>
                  {voiceCardFor([q.slug])}
                  <div className="flex flex-col gap-3">
                  <div
                    className={`flex flex-col gap-1 ${missingBorderCls(fileMissing)}`}
                    data-missing={fileMissing}
                  >
                    <MediaButtons
                      inspectionId={inspectionId}
                      targetId={target.id}
                      areaKey={phase.id}
                      questionKey={q.slug}
                      answerId={answer?.id}
                      label={q.label}
                      description={q.description}
                      required={q.required}
                    />
                    {fileMissing === 'strong' && (
                      <p className="text-xs font-medium text-red-600">
                        {MISSING_REQUIRED_TEXT}
                      </p>
                    )}
                    <AttachAffordance
                      inspectionId={inspectionId}
                      targetId={target.id}
                      areaKey={phase.id}
                      questionKey={q.slug}
                      answerId={answer?.id}
                      notes={answer?.notes}
                      onNotesChange={(n) => setNotes(q, n)}
                    />
                  </div>
                  {anchored.map((fq) =>
                    renderAnchoredFile(fq, {
                      inspectionId,
                      targetId: target.id,
                      areaKey: phase.id,
                      answers,
                      setNotes,
                    }),
                  )}
                  </div>
                </Fragment>
              );
            }

            // WS-Wifi: the download-speed question is the anchor for an inline
            // "run speed test" widget (LibreSpeed, see WifiSpeedTest.tsx). It
            // writes both the download and upload questions at once, so the
            // inspector doesn't have to run a separate app and type numbers in
            // by hand. Special-cased on slug rather than threaded through the
            // generic renderer since it's the only question that fills a sibling.
            const isWifiSpeedAnchor = q.slug === 'fv_wifi_download_speed_mbps';
            const wifiUploadQuestion = isWifiSpeedAnchor
              ? phase.questions.find((pq) => pq.slug === 'fv_wifi_upload_speed_mbps')
              : undefined;

            return (
              <Fragment key={key}>
                {voiceCardFor([q.slug])}
                <div className="flex flex-col gap-3">
                <QuestionRow
                  question={q}
                  inspectionId={inspectionId}
                  targetId={target.id}
                  areaKey={phase.id}
                  stepIndex={null}
                  hubValue={aiOrHubValue(phase.id, q.slug, null)}
                  justFilled={isJustFilled(phase.id, q.slug, null)}
                  missing={missingFor(q)}
                  answers={answers}
                  onChange={onChange}
                  setNotes={setNotes}
                />
                {isWifiSpeedAnchor && (
                  <WifiSpeedTest
                    onResult={({ downloadMbps, uploadMbps }) => {
                      void onChange(q, { value: Math.round(downloadMbps), wasAcceptedAsIs: false });
                      if (wifiUploadQuestion) {
                        void onChange(wifiUploadQuestion, { value: Math.round(uploadMbps), wasAcceptedAsIs: false });
                      }
                    }}
                  />
                )}
                {anchored.map((fq) =>
                  renderAnchoredFile(fq, {
                    inspectionId,
                    targetId: target.id,
                    areaKey: phase.id,
                    answers,
                    setNotes,
                  }),
                )}
                </div>
              </Fragment>
            );
          })}
        </div>
      </section>

      <div className="mt-6 flex justify-end">
        {nextIncompletePhaseIdx === null ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckIcon className="inline h-3.5 w-3.5" /> All required answered</span>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setCurrentIdx(nextIncompletePhaseIdx)}
            className="text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
          >
            Skip to next incomplete →
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => !isFirst && setCurrentIdx((i) => i - 1)}
          disabled={isFirst}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-40"
        >
          <span className="inline-flex items-center gap-1"><ChevronLeftIcon className="h-4 w-4" /> Prev</span>
        </button>
        <div className="text-xs text-gray-400 tabular-nums">
          {currentIdx + 1} / {phases.length}
        </div>
        {isLast ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={onBack}
            className="rounded-md bg-black px-4 py-2 text-sm text-white"
          >
            Done — back to overview ↩
          </button>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setCurrentIdx((i) => i + 1)}
            className="rounded-md bg-black px-4 py-2 text-sm text-white"
          >
            Next →
          </button>
        )}
      </div>
    </main>
  );
}

// Render an anchored file question inline beneath its anchor (WS-F). The
// rendering matches the standalone file-question branch in the main loop —
// MediaButtons + AttachAffordance — but is keyed off the anchored question's
// own slug so its answers are stored independently of the anchor.
function renderAnchoredFile(
  fq: FirstVisitQuestion,
  args: {
    inspectionId: string;
    targetId: string;
    /** Unused — anchored questions keep their original area_key (phase_id)
     *  so answer storage doesn't shift just because they render elsewhere. */
    areaKey: string;
    answers: Record<string, LocalAnswer>;
    setNotes: (q: FirstVisitQuestion, nextNotes: string, stepIndex?: number | null) => void;
  },
) {
  const { inspectionId, targetId, answers, setNotes } = args;
  // Anchored file-questions keep their original area_key. The visual location
  // moves; the storage coordinate doesn't. This means existing media (if any)
  // is preserved across the WS-F render change.
  const ownAreaKey = areaKeyFor(fq);
  const key = `${targetId}::${ownAreaKey}::${fq.slug}`;
  const answer = answers[key];
  return (
    <div
      key={`anchored-${fq.slug}`}
      data-anchored-to={fq.anchor_to}
      className="ml-3 flex flex-col gap-1 border-l-2 border-gray-100 pl-3"
    >
      <MediaButtons
        inspectionId={inspectionId}
        targetId={targetId}
        areaKey={ownAreaKey}
        questionKey={fq.slug}
        answerId={answer?.id}
        label={fq.label}
        description={fq.description}
        required={fq.required}
      />
      <AttachAffordance
        inspectionId={inspectionId}
        targetId={targetId}
        areaKey={ownAreaKey}
        questionKey={fq.slug}
        answerId={answer?.id}
        notes={answer?.notes}
        onNotesChange={(n) => setNotes(fq, n)}
      />
    </div>
  );
}

// Render plan node: either a single flat question or a grouped block of
// consecutive questions sharing a `group_id`. We walk the phase's question
// list once and merge runs of equal group_id into a single 'group' node so
// the StepGroup renderer owns the block lifecycle for that span.
type RenderNode =
  | { kind: 'question'; question: FirstVisitQuestion }
  | { kind: 'group'; groupId: string; questions: FirstVisitQuestion[] };

export function buildRenderPlan(questions: FirstVisitQuestion[]): RenderNode[] {
  const out: RenderNode[] = [];
  let bucket: { groupId: string; questions: FirstVisitQuestion[] } | null = null;
  for (const q of questions) {
    const gid = groupIdFor(q);
    if (gid == null) {
      if (bucket) {
        out.push({ kind: 'group', groupId: bucket.groupId, questions: bucket.questions });
        bucket = null;
      }
      out.push({ kind: 'question', question: q });
      continue;
    }
    if (bucket && bucket.groupId === gid) {
      bucket.questions.push(q);
    } else {
      if (bucket) {
        out.push({ kind: 'group', groupId: bucket.groupId, questions: bucket.questions });
      }
      bucket = { groupId: gid, questions: [q] };
    }
  }
  if (bucket) {
    out.push({ kind: 'group', groupId: bucket.groupId, questions: bucket.questions });
  }
  return out;
}
