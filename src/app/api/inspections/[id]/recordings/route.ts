import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { randomUUID } from "crypto";
import OpenAI, { toFile } from "openai";
import {
  getAreaRecordingsForBlock,
  getSavedAreasForInspection,
} from "@/lib/data";
import { loadOpenAIKey } from "@/lib/openaiKey";
import { areaAudioPath, areaPhotoPath, areaPhotoFolder } from "@/lib/constants";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inspectionId } = await params;
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") as "shared" | "unit" | null;
  const apartmentId = searchParams.get("apartment_id");

  if (!inspectionId || inspectionId.startsWith("demo-")) {
    return NextResponse.json({ error: "Missing inspection id" }, { status: 400 });
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  // No scope → every area saved so far, for the flow's resume lookup. With a
  // scope it stays the per-block fetch the follow-up screen does.
  if (!scope) {
    const recordings = await getSavedAreasForInspection(inspectionId);
    return NextResponse.json({ recordings });
  }

  const recordings = await getAreaRecordingsForBlock(
    inspectionId,
    scope,
    scope === "shared" ? null : apartmentId
  );

  return NextResponse.json({ recordings });
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
  // Whether THIS request carries newly captured audio. The flow saves a screen
  // several times (on stop, on each photo, on Next) and re-sends the same
  // storage path each time; without this every save would null the transcript
  // and pay for another Whisper run on identical audio.
  let audioChanged: boolean;

  if (isJson) {
    const body = await request.json();
    areaId = body.area_id ?? "";
    areaName = body.area_name ?? "";
    scope = body.scope ?? "";
    apartmentId = body.apartment_id ?? null;
    durationSeconds = parseInt(String(body.duration_seconds ?? 0), 10);
    audioPath = body.audio_storage_path ?? null;
    photoEntries = Array.isArray(body.photo_entries) ? body.photo_entries : [];
    audioChanged = body.audio_changed !== false;
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
      const storagePath = areaAudioPath(inspectionId, areaId, apartmentId);
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
    audioChanged = !!audioPath;
    photoEntries = [];
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      if (!(photo instanceof Blob) || photo.size === 0) continue;
      const photoId = randomUUID();
      const storagePath = areaPhotoPath(inspectionId, areaId, apartmentId, photoId);
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

  // Find the row this screen already has, so re-saving the same area updates it
  // instead of stacking duplicates — the flow now saves each screen more than
  // once (on stop, on each photo, on Next). PostgREST `is` only accepts
  // null/true/false, so passing a unit's UUID through it errored out, every
  // unit save missed its own row and inserted another one.
  let existingQuery = supabase
    .from("ins_area_recordings")
    .select("id, audio_path, transcript, transcript_status")
    .eq("inspection_id", inspectionId)
    .eq("area_id", areaId);
  existingQuery = apartmentId
    ? existingQuery.eq("apartment_id", apartmentId)
    : existingQuery.is("apartment_id", null);
  const { data: existing } = await existingQuery.maybeSingle();

  // A re-save of unchanged audio must not throw away the transcript we already
  // paid for: keep the row's own status so the follow-up screen and the report
  // still see it.
  const keepTranscript =
    !!existing?.id && !audioChanged && existing.transcript_status === "completed";

  let areaRecordingId: string | undefined;
  const recordingPayload = {
    apartment_id: apartmentId || null,
    area_id: areaId,
    area_name: areaName,
    scope,
    audio_path: audioPath,
    audio_duration_seconds: durationSeconds || null,
    transcript_status: keepTranscript ? "completed" : "pending",
  };

  if (existing?.id) {
    const updatePayload: Record<string, unknown> = { ...recordingPayload };
    if (audioPath && audioChanged) {
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

  // photo_entries is the COMPLETE set of photos for this area, not an addition to
  // it. The flow saves a screen repeatedly now, so appending blindly would stack
  // the same image again on every save and a photo the inspector deleted would
  // still reach the report. Converge instead: insert what is new, drop rows that
  // are no longer on screen.
  if (areaRecordingId) {
    const { data: storedPhotos } = await supabase
      .from("ins_inspection_photos")
      .select("id, storage_path")
      .eq("area_recording_id", areaRecordingId);

    // Scope the convergence to THIS area's own photo folder. Rows outside it are
    // not ours to remove: follow-up answers attach photos to the same recording
    // under `followup_<id>/`, and inspections that started before area photos
    // were namespaced by unit still hold photos under the older prefix.
    const ownedPrefix = areaPhotoFolder(inspectionId, areaId, apartmentId);
    const stored = new Map(
      (storedPhotos ?? [])
        .filter((r) => (r.storage_path as string).startsWith(ownedPrefix))
        .map((r) => [r.storage_path as string, r.id as string])
    );
    const wanted = new Set(photoEntries.map((e) => e.storagePath));

    const existingPaths = new Set(
      (storedPhotos ?? []).map((r) => r.storage_path as string)
    );
    for (const entry of photoEntries) {
      if (existingPaths.has(entry.storagePath)) continue;
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

    const removed = [...stored.entries()].filter(([path]) => !wanted.has(path));
    if (removed.length > 0) {
      const { error: photoDeleteError } = await supabase
        .from("ins_inspection_photos")
        .delete()
        .in(
          "id",
          removed.map(([, id]) => id)
        );
      if (photoDeleteError) {
        console.error("ins_inspection_photos delete failed:", photoDeleteError);
      } else {
        const { error: storageDeleteError } = await supabase.storage
          .from(PHOTOS_BUCKET)
          .remove(removed.map(([path]) => path));
        if (storageDeleteError) {
          console.error("Orphan photo cleanup failed:", storageDeleteError);
        }
      }
    }
  }

  loadOpenAIKey();
  const hasAudio = !!audioPath;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

  if (hasAudio && audioChanged && areaRecordingId && hasOpenAIKey && audioPath) {
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
