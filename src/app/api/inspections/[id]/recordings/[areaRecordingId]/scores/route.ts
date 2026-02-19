import { NextResponse } from "next/server";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { supabase } from "@/lib/supabase";
import { getAreaRecording } from "@/lib/data";
import OpenAI, { toFile } from "openai";
import { buildRescorePrompt, getQuestionTextById } from "@/lib/analyzePrompt";

const PHOTOS_BUCKET = "inspection-photos";
const AUDIO_BUCKET = "inspection-audio-recordings";

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

/** PATCH: Save follow-up answers (audio + photos) for an area recording */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; areaRecordingId: string }> }
) {
  const { id: inspectionId, areaRecordingId } = await params;

  if (!inspectionId || !areaRecordingId || inspectionId.startsWith("demo-")) {
    return NextResponse.json(
      { error: "Invalid inspection or area recording" },
      { status: 400 }
    );
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const recording = await getAreaRecording(areaRecordingId);
  if (!recording || recording.inspection_id !== inspectionId) {
    return NextResponse.json({ error: "Area recording not found" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const isFormData = contentType.includes("multipart/form-data");

  if (isFormData) {
    const formData = await request.formData();
    const audioKeys = [...formData.keys()].filter((k) => k.startsWith("audio_"));
    loadOpenAIKey();
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
    const rescoredUpdates: { question_id: string; score: number; details: string }[] = [];

    for (const key of audioKeys) {
      const questionId = key.replace("audio_", "");
      const audio = formData.get(key) as Blob | null;
      const durationStr = formData.get(`duration_${questionId}`) as string | null;
      if (!audio || !(audio instanceof Blob) || audio.size === 0) continue;

      const storagePath = `${inspectionId}/followup_${areaRecordingId}_${questionId}.webm`;
      const { error: uploadError } = await supabase.storage
        .from(AUDIO_BUCKET)
        .upload(storagePath, audio, { contentType: "audio/webm", upsert: true });
      if (uploadError) {
        console.error("Follow-up audio upload failed:", uploadError);
        continue;
      }

      let transcript: string | null = null;
      if (hasOpenAIKey) {
        try {
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const buffer = Buffer.from(await audio.arrayBuffer());
          const file = await toFile(buffer, "audio.webm");
          const result = await openai.audio.transcriptions.create({ file, model: "whisper-1" });
          transcript = result.text?.trim() ?? null;
        } catch (err) {
          console.error("Follow-up transcription failed:", err);
        }
      }

      await supabase
        .from("ins_question_scores")
        .update({
          follow_up_answer: transcript,
          updated_at: new Date().toISOString(),
        })
        .eq("area_recording_id", areaRecordingId)
        .eq("question_id", questionId);

      if (hasOpenAIKey && transcript) {
        try {
          const questionText = getQuestionTextById(questionId);
          const rescorePrompt = buildRescorePrompt(
            questionId,
            questionText,
            recording.transcript ?? "",
            transcript
          );
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "Re-score the question. Respond only with valid JSON: {\"score\": N, \"details\": \"...\"}" },
              { role: "user", content: rescorePrompt },
            ],
            temperature: 0.2,
          });
          const text = completion.choices[0]?.message?.content?.trim() ?? "";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
          const newScore = parsed.score;
          const newDetails = parsed.details;
          if (typeof newScore === "number" && newScore >= 1 && newScore <= 10) {
            await supabase
              .from("ins_question_scores")
              .update({
                score: newScore,
                details: newDetails ?? null,
                updated_at: new Date().toISOString(),
              })
              .eq("area_recording_id", areaRecordingId)
              .eq("question_id", questionId);
            rescoredUpdates.push({ question_id: questionId, score: newScore, details: newDetails ?? "" });
          }
        } catch (err) {
          console.error("Rescore failed:", err);
        }
      }
    }

    const photos = formData.getAll("photos") as Blob[];
    const photoQuestionIds = formData.getAll("photo_question_ids") as string[];
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      if (!(photo instanceof Blob) || photo.size === 0) continue;
      const questionId = photoQuestionIds[i] ?? null;
      const photoId = randomUUID();
      const storagePath = `${inspectionId}/followup_${areaRecordingId}/${photoId}.jpg`;

      const { error: photoError } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(storagePath, photo, { contentType: photo.type || "image/jpeg", upsert: false });
      if (photoError) {
        console.error("Follow-up photo upload failed:", photoError);
        continue;
      }

      await supabase.from("ins_inspection_photos").insert({
        area_recording_id: areaRecordingId,
        storage_path: storagePath,
        question_id: questionId,
      });
    }

    return NextResponse.json({ ok: true, rescored: rescoredUpdates });
  }

  const body = await request.json();
  const answers = body?.answers as Record<string, string> | undefined;
  if (!answers || typeof answers !== "object") {
    return NextResponse.json(
      { error: "Missing or invalid answers object" },
      { status: 400 }
    );
  }

  for (const [questionId, answer] of Object.entries(answers)) {
    if (answer == null || typeof answer !== "string") continue;

    await supabase
      .from("ins_question_scores")
      .update({
        follow_up_answer: answer.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("area_recording_id", areaRecordingId)
      .eq("question_id", questionId);
  }

  return NextResponse.json({ ok: true });
}
