import { BASE_QUESTIONS, getDeepDiveQuestions, getDeepDiveFromFocusAreas, DEEP_DIVE_LIBRARY } from "./questions";
import type { DealWithApartments } from "./types";

const SCORING_GUIDELINES = `
## Scoring Guidelines (strictly follow)
- **10 – Excellent:** No issues. Guest-ready.
- **8–9 – Good:** Minor imperfections only.
- **6–7 – Acceptable:** Noticeable wear/issue; still functional but affects perception.
- **4–5 – Poor:** Significant issues; functionality/cleanliness compromised.
- **1–3 – Very Poor:** Multiple issues; unacceptable or unsafe.

## Rules
- Score every high-level question based ONLY on the evidence in the transcript.
- If evidence is unclear or missing for a question → add a follow-up question to gather more info.
`.trim();

export interface QuestionForAnalysis {
  id: string;
  question: string;
  category: string;
}

export interface DeepDiveForArea {
  question: string;
  areaId: string;
}

/** Get all questions (base + deep-dive) for an area, for AI analysis. */
export function getQuestionsForArea(
  baseAreaId: string,
  scope: "shared" | "unit",
  deal: DealWithApartments | null,
  apartmentId: string | null
): { baseQuestions: QuestionForAnalysis[]; deepDives: DeepDiveForArea[] } {
  let questions = BASE_QUESTIONS[baseAreaId] ?? [];
  if (scope === "shared") {
    questions = questions.filter((q) => q.category !== "accuracy");
  }
  const baseQuestions: QuestionForAnalysis[] = questions.map((q) => ({
    id: q.id,
    question: q.question,
    category: q.category,
  }));

  let deepDives: DeepDiveForArea[] = [];
  if (scope === "shared" && deal?.focus_areas?.length) {
    deepDives = getDeepDiveFromFocusAreas(baseAreaId, deal.focus_areas).map((d) => ({
      question: d.question,
      areaId: baseAreaId,
    }));
  } else if (scope === "unit" && deal && apartmentId) {
    const apt = deal.apartments.find((a) => a.id === apartmentId);
    const issues = apt?.issues ?? [];
    deepDives = getDeepDiveQuestions(baseAreaId, issues).map((d) => ({
      question: d.question,
      areaId: baseAreaId,
    }));
  }

  return { baseQuestions, deepDives };
}

/** Deep-dive questions for an area (from DEEP_DIVE_LIBRARY). Used when score < 8 to add as follow-ups. */
export function getDeepDivesForArea(baseAreaId: string): string[] {
  return DEEP_DIVE_LIBRARY
    .filter((d) => d.areaId === baseAreaId)
    .map((d) => d.question);
}

/** Build the system + user prompt for AI analysis. */
export function buildAnalysisPrompt(
  areaName: string,
  transcript: string,
  baseQuestions: QuestionForAnalysis[],
  deepDives: DeepDiveForArea[]
): string {
  const questionsBlock = baseQuestions
    .map((q) => `- **${q.id}**: ${q.question}`)
    .join("\n");

  const deepDiveBlock =
    deepDives.length > 0
      ? `\n### Deep-dive questions (add as follow-ups when any base question scores < 8)\n${deepDives.map((d) => `- ${d.question}`).join("\n")}`
      : "";

  return `You are analyzing a property inspection transcript for the area: **${areaName}**.

${SCORING_GUIDELINES}

### Transcript
"""
${transcript || "(No transcript — inspector skipped or recording failed.)"}
"""

### Questions to score (score each based ONLY on transcript evidence)
${questionsBlock}
${deepDiveBlock}

### Output format (JSON only, no markdown)
Return valid JSON with this exact structure:
{
  "scores": [
    { "question_id": "ext_checkin", "score": 8, "details": "Brief reasoning from transcript evidence" }
  ],
  "follow_ups": [
    { "question_id": "ext_clean", "question": "What you need to ask to fill the gap", "reason": "Evidence was unclear about X" }
  ]
}

Rules for output:
- Include one score object per base question. Use score null only if transcript is empty.
- If transcript is empty, set all scores to null and add follow-ups asking for the key observations.
- Add follow_ups when: (a) evidence is unclear, OR (b) any base question scores < 8 — in that case, add the matching deep-dive question(s) for that area.
- Keep details and reason concise.`;
}

const RESCORE_GUIDELINES = `
## Scoring Guidelines (strictly follow)
- **10 – Excellent:** No issues. Guest-ready.
- **8–9 – Good:** Minor imperfections only.
- **6–7 – Acceptable:** Noticeable wear/issue; still functional but affects perception.
- **4–5 – Poor:** Significant issues; functionality/cleanliness compromised.
- **1–3 – Very Poor:** Multiple issues; unacceptable or unsafe.
`.trim();

/** Get question text by id from BASE_QUESTIONS. */
export function getQuestionTextById(questionId: string): string {
  for (const arr of Object.values(BASE_QUESTIONS)) {
    const q = arr.find((x) => x.id === questionId);
    if (q) return q.question;
  }
  return questionId;
}

/** Build prompt for re-scoring a question after follow-up answer. */
export function buildRescorePrompt(
  questionId: string,
  questionText: string,
  originalTranscript: string,
  followUpAnswer: string
): string {
  return `You are re-scoring a property inspection question based on additional evidence from a follow-up.

${RESCORE_GUIDELINES}

### Question (${questionId})
${questionText}

### Original area transcript
"""
${originalTranscript || "(empty)"}
"""

### Follow-up answer (inspector's response)
"""
${followUpAnswer}
"""

### Task
Re-score this question (1-10) using BOTH the original transcript AND the follow-up answer. Update your assessment accordingly.

### Output format (JSON only)
{"score": 8, "details": "Brief reasoning incorporating the new evidence"}
`;
}
