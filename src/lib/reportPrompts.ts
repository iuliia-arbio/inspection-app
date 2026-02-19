import type { ReportData } from "./reportData";
import { buildBlockScoresMap, getQuestionText } from "./reportData";

/** Build prompt for AI to generate inspection summary. */
export function buildSummaryPrompt(data: ReportData): string {
  const blocksText = data.blocks.map((block) => {
    const scoresMap = buildBlockScoresMap(block);
    const scoresStr = Object.entries(scoresMap)
      .filter(([, v]) => v != null)
      .map(([qId, score]) => `  - ${getQuestionText(qId)}: ${score}/10`)
      .join("\n");
    const transcripts = block.recordings
      .map((r) => r.recording.transcript)
      .filter(Boolean)
      .join("\n\n");
    return `### ${block.blockName}
Known issues from reviews: ${block.issues.length ? block.issues.join("; ") : "None"}
Scores: ${scoresStr || "N/A"}
Transcripts:
"""
${transcripts || "(No transcript)"}
"""`;
  });

  const knownIssuesAll = data.blocks.flatMap((b) => b.issues);
  const focusAreasStr =
    data.focusAreas
      ?.map((f) => `${f.category}: ${f.issues.join(", ")}`)
      .join("\n") ?? "";
  const freestyleStr =
    data.freestyleTranscripts.length > 0
      ? data.freestyleTranscripts.join("\n\n")
      : "(No freestyle notes)";

  return `You are writing an executive summary for a property inspection report.

## Deal: ${data.deal.deal_sku}
## Inspected: ${data.blocks.map((b) => b.blockName).join(", ")}

### Known issues (from guest reviews) - consider if inspection findings align
${knownIssuesAll.length ? knownIssuesAll.join("\n") : "None"}
${focusAreasStr ? `\n### Deal focus areas\n${focusAreasStr}` : ""}

### Inspection findings (scores 1-10 and transcripts per area)
${blocksText.join("\n\n")}

### Freestyle / additional notes
"""
${freestyleStr}
"""

## Task
Write a concise executive summary (3-5 short paragraphs) covering:
1. Main problematic areas — only mention issues that were EXPLICITLY mentioned in the transcripts. Do NOT assume problems or infer issues that were not stated.
2. Whether findings correspond to known issues from reviews — only for issues that were actually discussed in the inspection.
3. Known issues NOT covered — if there are known issues from reviews that were NOT addressed in the inspection, explicitly state: "The following known issues were not covered in this inspection: [list them]." Exclude host responsiveness and customer service from this list — these cannot be assessed during a physical inspection.
4. General state of the inspected apartments (overall assessment) — based only on what was observed and recorded.

Write in clear, professional language. No bullet points in the summary - use paragraphs. Do not assume or infer problems that were not explicitly mentioned. Do not mention host responsiveness or customer service — these cannot be assessed during a physical inspection.`;
}

export interface CategorizedIssues {
  cleanliness_issues: string[];
  maintenance_issues: string[];
  checkin_issues: string[];
  accuracy_issues: string[];
}

/** Build prompt for AI to categorize issues for a single block. */
export function buildIssuesPromptForBlock(block: import("./reportData").ReportBlockData): string {
  const scoresMap = buildBlockScoresMap(block);
  const lowScores = Object.entries(scoresMap)
    .filter(([, v]) => v != null && v < 8)
    .map(([qId, score]) => {
      const scoreRow = block.recordings
        .flatMap((r) => r.scores)
        .find((s) => s.question_id === qId);
      return {
        question: getQuestionText(qId),
        score: score!,
        details: scoreRow?.details ?? "",
      };
    });
  const transcripts = block.recordings
    .map((r) => `${r.recording.area_name}:\n${r.recording.transcript || "(none)"}`)
    .join("\n\n");
  const areasInspected = block.recordings.map((r) => r.recording.area_name).join(", ");

  return `You are categorizing issues found during a property inspection for: **${block.blockName}**.

## Scope
This block covers: ${areasInspected}
Extract issues ONLY from the transcripts below. Do NOT copy issues from other blocks (e.g. if "graffiti at entrance" is in Shared Areas, do NOT add it to a Unit block unless graffiti is also mentioned in that unit's inspection).

## Low scores and details
${JSON.stringify(lowScores, null, 2)}

## Transcripts
"""
${transcripts || "(No transcript)"}
"""

## Task
Extract all issues explicitly mentioned in the transcripts above. Categorize each into exactly ONE of these 4 categories:
1. **cleanliness_issues** - Dirt, stains, dust, hair, mold, grime, unclean surfaces
2. **maintenance_issues** - Broken items, leaks, damage, wear, repairs needed, non-working fixtures
3. **checkin_issues** - Key/lockbox problems, unclear instructions, access difficulties
4. **accuracy_issues** - Listing mismatches, things not as photographed/described

Rules:
- Each issue in EXACTLY one category (choose the best fit)
- No duplicates across categories
- Only include issues explicitly mentioned in THIS block's transcripts
- No duplicate entries (if same issue mentioned twice, list once)

Output valid JSON only:
{
  "cleanliness_issues": ["issue 1", "issue 2"],
  "maintenance_issues": ["issue 1"],
  "checkin_issues": [],
  "accuracy_issues": []
}`;
}
