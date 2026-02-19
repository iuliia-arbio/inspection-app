import { NextResponse } from "next/server";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { supabase } from "@/lib/supabase";
import OpenAI from "openai";
import { getAreaRecording } from "@/lib/data";
import { getDealById } from "@/lib/data";
import { getInspection } from "@/lib/data";
import { buildAnalysisPrompt, getQuestionsForArea } from "@/lib/analyzePrompt";
import { generateDeepDiveQuestions } from "@/lib/generateDeepDives";

function loadOpenAIKey() {
  if (process.env.OPENAI_API_KEY) return;
  const cwd = process.cwd();
  const possiblePaths = [
    resolve(cwd, ".env.local"),
    resolve(cwd, "inspection-app", ".env.local"),
  ];
  for (const envPath of possiblePaths) {
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(/^OPENAI_API_KEY=(.+)$/m);
    if (match) {
      process.env.OPENAI_API_KEY = match[1].trim();
      return;
    }
  }
}

function getBaseAreaId(areaId: string): string {
  return areaId.replace(/_\d+$/, "");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; areaRecordingId: string }> }
) {
  const { id: inspectionId, areaRecordingId } = await params;

  if (!inspectionId || !areaRecordingId || inspectionId.startsWith("demo-")) {
    return NextResponse.json({ error: "Invalid inspection or area recording" }, { status: 400 });
  }

  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  loadOpenAIKey();
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 503 }
    );
  }

  const recording = await getAreaRecording(areaRecordingId);
  if (!recording || recording.inspection_id !== inspectionId) {
    return NextResponse.json({ error: "Area recording not found" }, { status: 404 });
  }

  const inspection = await getInspection(inspectionId);
  if (!inspection?.dealId) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  const deal = await getDealById(inspection.dealId);
  const baseAreaId = getBaseAreaId(recording.area_id);
  const scope = (recording.scope as "shared" | "unit") ?? "unit";

  const { baseQuestions, deepDives } = getQuestionsForArea(
    baseAreaId,
    scope,
    deal,
    recording.apartment_id
  );

  if (baseQuestions.length === 0) {
    return NextResponse.json(
      { error: "No questions configured for this area" },
      { status: 400 }
    );
  }

  let deepDivesForPrompt = deepDives;
  if (scope === "shared" && deal?.focus_areas?.length) {
    const aiQuestions = await generateDeepDiveQuestions({
      type: "shared",
      areaId: baseAreaId,
      focusAreas: deal.focus_areas,
    });
    if (aiQuestions.length > 0) {
      deepDivesForPrompt = aiQuestions.map((q) => ({ question: q, areaId: baseAreaId }));
    }
  } else if (scope === "unit" && recording.apartment_id && deal) {
    const aptIssues = deal.apartments.find((a) => a.id === recording.apartment_id)?.issues ?? [];
    if (aptIssues.length > 0) {
      const aiQuestions = await generateDeepDiveQuestions({
        type: "unit",
        areaId: baseAreaId,
        issues: aptIssues,
      });
      if (aiQuestions.length > 0) {
        deepDivesForPrompt = aiQuestions.map((q) => ({ question: q, areaId: baseAreaId }));
      }
    }
  }

  const prompt = buildAnalysisPrompt(
    recording.area_name,
    recording.transcript ?? "",
    baseQuestions,
    deepDivesForPrompt
  );

  let parsed: {
    scores: { question_id: string; score: number | null; details: string }[];
    follow_ups: { question_id?: string; question: string; reason: string }[];
  };

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You analyze property inspection transcripts and score questions. Respond only with valid JSON, no markdown.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : text;
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.error("AI analysis failed:", err);
    return NextResponse.json(
      { error: "AI analysis failed" },
      { status: 500 }
    );
  }

  const scores = parsed.scores ?? [];
  let followUps = parsed.follow_ups ?? [];

  const areaDeepDiveQuestions = deepDivesForPrompt.map((d) => d.question);
  for (const s of scores) {
    if (typeof s.score === "number" && s.score < 8 && areaDeepDiveQuestions.length > 0) {
      for (const q of areaDeepDiveQuestions) {
        if (!followUps.some((f) => f.question === q)) {
          followUps.push({
            question_id: s.question_id,
            question: q,
            reason: `Score ${s.score} below 8 — deep-dive required`,
          });
        }
      }
    }
  }

  const followUpByBaseQuestion: Record<string, string> = {};
  for (const f of followUps) {
    const baseId = f.question_id ?? "";
    if (!baseId) continue;
    const existing = followUpByBaseQuestion[baseId];
    followUpByBaseQuestion[baseId] = existing
      ? `${existing}\n\n${f.question}`
      : f.question;
  }

  for (const s of scores) {
    const followUpQuestion = followUpByBaseQuestion[s.question_id] ?? null;
    await supabase.from("ins_question_scores").upsert(
      {
        area_recording_id: areaRecordingId,
        question_id: s.question_id,
        score: s.score,
        details: s.details ?? null,
        follow_up_question: followUpQuestion,
        follow_up_answer: null,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "area_recording_id,question_id",
      }
    );
  }

  const followUpRows = Object.entries(followUpByBaseQuestion).map(([question_id, question]) => ({
    question_id,
    question,
    reason: followUps.find((f) => f.question_id === question_id)?.reason ?? "",
  }));

  return NextResponse.json({
    scores: scores.map((s) => ({
      question_id: s.question_id,
      score: s.score,
      details: s.details,
    })),
    followUps: followUpRows,
  });
}
