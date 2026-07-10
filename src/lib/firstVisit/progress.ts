import { localDb, type LocalAnswer } from './db';
import {
  PHASES,
  filterPhasesForScope,
  isScopeLevelRequired,
  isVisible,
  type FirstVisitPhase,
  type FirstVisitQuestion,
} from './questions';
import type { HubScope } from './resolveScope';
import { isAnswered } from '@/components/firstVisit/ProgressRing';

export type ScopeProgress = { done: number; total: number };

// Scope-level required questions that are currently visible. A question hidden
// by an unsatisfied visible_when rule must not count toward the ring's total,
// otherwise the ring becomes uncompletable. Pure — reused by the submit
// dialog's "unanswered required" list. answersByKey maps controlling-question
// slug → answer value.
export function requiredVisible(
  questions: FirstVisitQuestion[],
  answersByKey: Map<string, unknown>,
): FirstVisitQuestion[] {
  return questions.filter(
    (q) => isScopeLevelRequired(q) && isVisible(q.visible_when, answersByKey),
  );
}

// Photo/video capture writes only the media table — no answer row carries a
// value — so a required file question is "answered" when the caller-supplied
// set of media-answered question keys contains its slug. Keys are plain media
// question_key values for ONE target (repeater media carry a `::step` suffix
// and never match, which is correct — repeater members are excluded from
// scope-level required by isScopeLevelRequired). LOCAL media only for now: a
// cloud-restored device has hub metadata but no local media rows, so its file
// questions read as missing — known limitation until remote media is wired in.
function isAnsweredWithMedia(
  q: FirstVisitQuestion,
  a: LocalAnswer | undefined,
  mediaKeys: Set<string> | undefined,
): boolean {
  if (a && isAnswered(a.value)) return true;
  return q.type === 'file' && !!mediaKeys?.has(q.slug);
}

// Count required questions for a scope and how many are answered at the given
// target_id. Required-only — optional questions never contribute to the ring.
// `phases` defaults to the bundled PHASES; injecting a different set (e.g. a
// runtime survey config from SurveyConfigContext) lets the same denominator
// logic run against config that isn't compiled in — zero change for existing
// callers. `mediaKeys` marks file questions answered via captured media.
export function computeProgressFromAnswers(
  scope: HubScope,
  answers: LocalAnswer[],
  phaseIds?: string[],
  phases: FirstVisitPhase[] = PHASES,
  mediaKeys?: Set<string>,
): ScopeProgress {
  const questions = filterPhasesForScope(phases, scope, phaseIds).flatMap(
    (p) => p.questions,
  );
  const byKey = new Map<string, LocalAnswer>();
  for (const a of answers) byKey.set(a.question_key, a);
  // Repeater-group members (group_id set) are required only within a populated
  // block, never at scope level — see isScopeLevelRequired. Questions hidden by
  // an unsatisfied visible_when rule are likewise excluded. Both keep the ring
  // completable.
  const valueByKey = new Map<string, unknown>(
    [...byKey.entries()].map(([k, a]) => [k, a.value]),
  );
  const required = requiredVisible(questions, valueByKey);
  let done = 0;
  for (const q of required) {
    if (isAnsweredWithMedia(q, byKey.get(q.slug), mediaKeys)) done += 1;
  }
  return { done, total: required.length };
}

// A target (deal / property / unit) the submit dialog needs a "what's left"
// list for. `answers` are this target's own answers; `phaseIds` optionally
// narrows to a phase subset; `phases` injects a runtime config (defaults to
// bundled PHASES) so the dialog and the ring measure against the same set.
export type RemainingTargetInput = {
  label: string;
  scope: HubScope;
  answers: LocalAnswer[];
  phaseIds?: string[];
  phases?: FirstVisitPhase[];
  // Question keys answered via captured media (see isAnsweredWithMedia).
  mediaKeys?: Set<string>;
};

// A target grouped with its still-unanswered required questions, ready for the
// submit dialog. Complete targets are omitted by remainingRequiredByTarget.
export type RemainingGroup = {
  label: string;
  questions: FirstVisitQuestion[];
};

// Pure: the unanswered, visible, scope-level required questions for one target.
// Reuses requiredVisible + isAnswered so the "what's left" list stays consistent
// with the completion ring. Empty array means the target is complete.
export function remainingRequiredForTarget(
  target: RemainingTargetInput,
): FirstVisitQuestion[] {
  const questions = filterPhasesForScope(
    target.phases ?? PHASES,
    target.scope,
    target.phaseIds,
  ).flatMap((p) => p.questions);
  const byKey = new Map<string, LocalAnswer>();
  for (const a of target.answers) byKey.set(a.question_key, a);
  const valueByKey = new Map<string, unknown>(
    [...byKey.entries()].map(([k, a]) => [k, a.value]),
  );
  const required = requiredVisible(questions, valueByKey);
  return required.filter(
    (q) => !isAnsweredWithMedia(q, byKey.get(q.slug), target.mediaKeys),
  );
}

// Aggregate the "what's left" list across every target in the visit. Groups
// with nothing remaining are dropped so the dialog only shows targets that
// still need work. Pure — callers pass already-loaded answers.
export function remainingRequiredByTarget(
  targets: RemainingTargetInput[],
): RemainingGroup[] {
  const groups: RemainingGroup[] = [];
  for (const t of targets) {
    const questions = remainingRequiredForTarget(t);
    if (questions.length > 0) groups.push({ label: t.label, questions });
  }
  return groups;
}

export async function loadAnswersForTarget(targetId: string): Promise<LocalAnswer[]> {
  return localDb.answers.where('target_id').equals(targetId).toArray();
}

export async function loadProgressForTarget(
  targetId: string,
  scope: HubScope,
  phaseIds?: string[],
): Promise<ScopeProgress> {
  const answers = await loadAnswersForTarget(targetId);
  return computeProgressFromAnswers(scope, answers, phaseIds);
}
