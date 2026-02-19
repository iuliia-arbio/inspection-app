import OpenAI from "openai";
import {
  getDeepDiveQuestions,
  getDeepDiveFromFocusAreas,
  hasIssuesForArea,
  hasIssuesForAreaFromFocusAreas,
} from "./questions";

const AREA_NAMES: Record<string, string> = {
  exterior: "Exterior & Building Access",
  common: "Common Areas",
  entrance: "Entrance & Hallway",
  living: "Living Room",
  kitchen: "Kitchen",
  dining: "Dining Area",
  bedroom: "Bedroom",
  bathroom: "Bathroom",
  balcony: "Balcony / Outdoor",
  storage: "Storage Areas",
  overall: "Overall Furnishings & Décor",
};

export type DeepDiveInput =
  | { type: "unit"; areaId: string; issues: string[] }
  | { type: "shared"; areaId: string; focusAreas: { category: string; issues: string[] }[] };

/** Generate 1–3 specific deep-dive questions using AI, based on known issues. Falls back to keyword-based when OpenAI is unavailable. */
export async function generateDeepDiveQuestions(input: DeepDiveInput): Promise<string[]> {
  const baseAreaId = input.areaId.replace(/_\d+$/, "");
  const areaName = AREA_NAMES[baseAreaId] ?? baseAreaId;

  const issues =
    input.type === "unit"
      ? input.issues
      : input.type === "shared"
        ? input.focusAreas.flatMap((f) => f.issues ?? [])
        : [];

  if (!issues.length) return [];

  const hasRelevantIssues =
    input.type === "unit"
      ? hasIssuesForArea(input.areaId, input.issues)
      : hasIssuesForAreaFromFocusAreas(input.areaId, input.focusAreas);
  if (!hasRelevantIssues) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return getFallbackQuestions(input);
  }

  try {
    const openai = new OpenAI({ apiKey });
    const issuesText = issues.join("\n- ");
    const scope = input.type === "unit" ? "this apartment unit" : "shared areas";

    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You generate 1–3 short follow-up questions for a property inspector who is physically inspecting the space.

CRITICAL RULES:
1. Each question must ONLY be about the specific area: ${areaName}. Never mention other areas (e.g. do not ask about "adjacent bedroom" in a bathroom question — bathroom questions must only be about bathroom fixtures, shower, toilet, grout, etc.)
2. Only include questions the inspector can answer by OBSERVING the property — fixtures, cleanliness, condition, appliances, furnishings. They cannot assess customer service, response times, host communication, check-in instructions, or anything outside the physical space.
3. Skip or ignore known issues that are NOT property-related (customer service, host responsiveness, WiFi instructions, etc.). Return fewer questions or empty array if only such issues exist.
4. Reference specific items mentioned (stove, towels, grout) — never use generic adjectives like "dirty" as the subject.
5. Return JSON: {"questions": ["question 1?", "question 2?"]} — or {"questions": []} if no property-relevant questions for this area.`,
        },
        {
          role: "user",
          content: `Area: ${areaName} (${scope})
Known issues from guest reviews:
- ${issuesText}

Generate 1–3 questions ONLY for this area, ONLY about what the inspector can see/photograph. Exclude service, communication, or non-physical issues.`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 300,
    });

    const text = choices[0]?.message?.content?.trim();
    if (!text) return getFallbackQuestions(input);

    const parsed = JSON.parse(text) as { questions?: string[] };
    const list = parsed?.questions;
    if (Array.isArray(list) && list.length > 0) {
      return list
        .slice(0, 3)
        .filter((q): q is string => typeof q === "string" && q.length > 5);
    }
  } catch (e) {
    console.error("AI deep-dive generation failed:", e);
  }

  return getFallbackQuestions(input);
}

function getFallbackQuestions(input: DeepDiveInput): string[] {
  const baseAreaId = input.areaId.replace(/_\d+$/, "");
  if (input.type === "unit") {
    return getDeepDiveQuestions(baseAreaId, input.issues).map((d) => d.question);
  }
  return getDeepDiveFromFocusAreas(baseAreaId, input.focusAreas).map((d) => d.question);
}
