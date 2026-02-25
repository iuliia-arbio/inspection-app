import { NextResponse } from "next/server";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { supabase } from "@/lib/supabase";
import { randomUUID } from "crypto";
import OpenAI, { toFile } from "openai";
import { getAreaRecordingsForBlock } from "@/lib/data";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inspectionId } = await params;
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") as "shared" | "unit" | null;
  const apartmentId = searchParams.get("apartment_id");

  if (!inspectionId || inspectionId.startsWith("demo-") || !scope) {
    return NextResponse.json(
      { error: "Missing inspection id or scope" },
      { status: 400 }
    );
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const recordings = await getAreaRecordingsForBlock(
    inspectionId,
    scope,
    scope === "shared" ? null : apartmentId
  );

  return NextResponse.json({ recordings });
}

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

const AUDIO_BUCKET = "inspection-audio-recordings";
const PHOTOS_BUCKET = "inspection-photos";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inspectionId } = await params;
  if (!inspectionId || inspectionId.startsWith("demo-")) {
    return NextResponse.json({ ok: true }); // Skip for demo
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  let areaId: string;
  let areaName: string;
  let scope: string;
  let apartmentId: string | null;
  let durationSeconds: number;
  let audioPath: string | null;
  let photoEntries: { storagePath: string; questionId: string | null }[];

  if (isJson) {
    const body = await request.json();
    areaId = body.area_id ?? "";
    areaName = body.area_name ?? "";
    scope = body.scope ?? "";
    apartmentId = body.apartment_id ?? null;
    durationSeconds = parseInt(String(body.duration_seconds ?? 0), 10);
    audioPath = body.audio_storage_path ?? null;
    photoEntries = Array.isArray(body.photo_entries) ? body.photo_entries : [];
  } else {
    const formData = await request.formData();
    const audio = formData.get("audio") as Blob | null;
    areaId = (formData.get("area_id") as string) ?? "";
    areaName = (formData.get("area_name") as string) ?? "";
    scope = (formData.get("scope") as string) ?? "";
    apartmentId = (formData.get("apartment_id") as string) ?? null;
    durationSeconds = parseInt(
      (formData.get("duration_seconds") as string) ?? "0",
      10
    );
    const photos = formData.getAll("photos") as Blob[];
    const photoQuestionIds = formData.getAll("photo_question_ids") as string[];

    if (audio && audio.size > 0) {
      const storagePath = `${inspectionId}/${areaId}.webm`;
      const { error: uploadError } = await supabase.storage
        .from(AUDIO_BUCKET)
        .upload(storagePath, audio, {
          contentType: "audio/webm",
          upsert: true,
        });
      if (uploadError) {
        console.error("Storage upload failed:", uploadError);
        return NextResponse.json(
          { error: "Failed to upload recording" },
          { status: 500 }
        );
      }
      audioPath = storagePath;
    } else {
      audioPath = null;
    }
    photoEntries = [];
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      if (!(photo instanceof Blob) || photo.size === 0) continue;
      const photoId = randomUUID();
      const storagePath = `${inspectionId}/${areaId}/${photoId}.jpg`;
      const { error: photoUploadError } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(storagePath, photo, {
          contentType: photo.type || "image/jpeg",
          upsert: false,
        });
      if (photoUploadError) {
        console.error("Photo upload failed:", photoUploadError);
        continue;
      }
      photoEntries.push({
        storagePath,
        questionId: (photoQuestionIds[i] as string) ?? null,
      });
    }
  }

  if (!areaId || !areaName || !scope) {
    return NextResponse.json(
      { error: "Missing area_id, area_name, or scope" },
      { status: 400 }
    );
  }

  const { data: existing } = await supabase
    .from("ins_area_recordings")
    .select("id")
    .eq("inspection_id", inspectionId)
    .eq("area_id", areaId)
    .is("apartment_id", apartmentId || null)
    .maybeSingle();

  let areaRecordingId: string | undefined;
  const recordingPayload = {
    apartment_id: apartmentId || null,
    area_id: areaId,
    area_name: areaName,
    scope,
    audio_path: audioPath,
    audio_duration_seconds: durationSeconds || null,
    transcript_status: "pending",
  };

  if (existing?.id) {
    const updatePayload: Record<string, unknown> = { ...recordingPayload };
    if (audioPath) {
      updatePayload.transcript = null;
    }
    const { data: updated, error: updateError } = await supabase
      .from("ins_area_recordings")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("id")
      .single();

    if (updateError) {
      console.error("Update ins_area_recordings failed:", updateError);
      return NextResponse.json(
        { error: "Failed to update recording" },
        { status: 500 }
      );
    }
    areaRecordingId = updated?.id;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("ins_area_recordings")
      .insert({
        inspection_id: inspectionId,
        ...recordingPayload,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Insert ins_area_recordings failed:", insertError);
      return NextResponse.json(
        { error: "Failed to save recording" },
        { status: 500 }
      );
    }
    areaRecordingId = inserted?.id;
  }

  if (areaRecordingId && photoEntries.length > 0) {
    for (const entry of photoEntries) {
      const { error: photoInsertError } = await supabase
        .from("ins_inspection_photos")
        .insert({
          area_recording_id: areaRecordingId,
          storage_path: entry.storagePath,
          question_id: entry.questionId,
        });
      if (photoInsertError) {
        console.error("ins_inspection_photos insert failed:", photoInsertError);
      }
    }
  }

  loadOpenAIKey();
  const hasAudio = !!audioPath;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

  if (hasAudio && areaRecordingId && hasOpenAIKey && audioPath) {
    try {
      const { data: audioBlob, error: downloadError } = await supabase.storage
        .from(AUDIO_BUCKET)
        .download(audioPath);
      if (downloadError || !audioBlob) {
        console.error("Failed to download audio for transcription:", downloadError);
      } else {
        const buffer = Buffer.from(await audioBlob.arrayBuffer());
        const file = await toFile(buffer, "audio.webm");
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const transcription = await openai.audio.transcriptions.create({
          file,
          model: "whisper-1",
        });
        const transcript = transcription.text?.trim() ?? "";

        const { error: updateError } = await supabase
          .from("ins_area_recordings")
          .update({
            transcript: transcript || null,
            transcript_status: transcript ? "completed" : "pending",
          })
          .eq("id", areaRecordingId);

        if (updateError) {
          console.error("Failed to save transcript:", updateError);
        }
      }
    } catch (err) {
      console.error("Whisper transcription failed:", err);
      const { error: updateError } = await supabase
        .from("ins_area_recordings")
        .update({ transcript_status: "failed" })
        .eq("id", areaRecordingId);
      if (updateError) console.error("Failed to update transcript_status:", updateError);
    }
  }

  return NextResponse.json({ ok: true, areaRecordingId });
}
