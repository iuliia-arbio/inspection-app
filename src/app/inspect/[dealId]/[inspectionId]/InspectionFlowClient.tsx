"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { BASE_QUESTIONS, hasIssuesForArea, hasIssuesForAreaFromFocusAreas } from "@/lib/questions";
import { buildBlocks, getBaseAreaId } from "@/lib/inspection";
import { useVoiceRecorder, formatDuration } from "@/lib/useVoiceRecorder";
import type { DealWithApartments } from "@/lib/types";

type Screen = "inspection" | "unit_config" | "followup" | "freestyle" | "done";

export default function InspectionFlowClient({
  deal,
  inspectionId,
}: {
  deal: DealWithApartments | null;
  inspectionId: string;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("inspection");
  const [blockIndex, setBlockIndex] = useState(0);
  const [areaIndex, setAreaIndex] = useState(0);
  const [initialState, setInitialState] = useState<{
    selectedUnitIds: string[];
    unitConfigs: Record<string, { bedrooms: number; bathrooms: number; living_rooms: number; kitchen: number; balcony: number }>;
    includeSharedAreas?: boolean;
  } | null | "loading">(null);
  const [unitConfigs, setUnitConfigs] = useState<
    Record<string, { bedrooms: number; bathrooms: number; living_rooms: number; kitchen: number; balcony: number }>
  >({});
  const [configTargetBlockIndex, setConfigTargetBlockIndex] = useState<number | null>(null);
  const [followUpBlockContext, setFollowUpBlockContext] = useState<{
    scope: "shared" | "unit";
    apartmentId: string | null;
  } | null>(null);
  const [analysis, setAnalysis] = useState<{
    areas: Array<{
      areaRecordingId: string;
      areaName: string;
      baseAreaId: string;
      scores: { question_id: string; score: number | null; details: string }[];
      followUps: { question_id: string; question: string; reason: string }[];
    }>;
  } | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [deepDiveCache, setDeepDiveCache] = useState<Record<string, string[]>>({});
  const deepDiveFetchedRef = useRef<string | null>(null);
  const firstUnitConfigShownRef = useRef(false);

  useEffect(() => {
    setDeepDiveCache({});
    deepDiveFetchedRef.current = null;
    firstUnitConfigShownRef.current = false;
  }, [inspectionId]);

  const [followUpAudio, setFollowUpAudio] = useState<Record<string, { blob: Blob; durationSeconds: number }>>({});
  const [followUpPhotos, setFollowUpPhotos] = useState<Record<string, { blob: Blob; url: string }[]>>({});
  const activeFollowUpKeyRef = useRef<string | null>(null);
  const followupPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const followupRecorder = useVoiceRecorder();

  const recorder = useVoiceRecorder();
  const recordingsRef = useRef<Map<string, { blob: Blob; durationSeconds: number }>>(new Map());
  const [photosByQuestion, setPhotosByQuestion] = useState<Record<string, { blob: Blob; url: string }[]>>({});
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const activeQuestionRef = useRef<string | null>(null);

  // Reset recorder and photos when navigating to a new area
  const { reset: resetRecorder } = recorder;
  useEffect(() => {
    resetRecorder();
    setPhotosByQuestion((prev) => {
      Object.values(prev).flat().forEach((p) => URL.revokeObjectURL(p.url));
      return {};
    });
  }, [blockIndex, areaIndex, resetRecorder]);

  useEffect(() => {
    if (screen === "followup" && followupRecorder.status === "recorded" && followupRecorder.blob && activeFollowUpKeyRef.current) {
      const key = activeFollowUpKeyRef.current;
      setFollowUpAudio((prev) => ({
        ...prev,
        [key]: { blob: followupRecorder.blob!, durationSeconds: followupRecorder.durationSeconds },
      }));
      followupRecorder.reset();
      activeFollowUpKeyRef.current = null;
    }
  }, [screen, followupRecorder.status, followupRecorder.blob, followupRecorder.durationSeconds]);

  useEffect(() => {
    if (screen !== "followup" || !followUpBlockContext || inspectionId.startsWith("demo-")) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    const { scope, apartmentId } = followUpBlockContext;
    const query = new URLSearchParams({ scope });
    if (apartmentId) query.set("apartment_id", apartmentId);
    fetch(`/api/inspections/${inspectionId}/recordings?${query}`)
      .then((r) => r.json())
      .then(({ recordings = [] }) => {
        if (recordings.length === 0) {
          setAnalysis({ areas: [] });
          setAnalysisLoading(false);
          return;
        }
        const analyzeAll = Promise.all(
          recordings.map((rec: { id: string; area_id: string; area_name: string }) =>
            fetch(`/api/inspections/${inspectionId}/recordings/${rec.id}/analyze`, {
              method: "POST",
            })
              .then((res) => (res.ok ? res.json() : { scores: [], followUps: [] }))
              .then((data) => ({
                areaRecordingId: rec.id,
                areaName: rec.area_name,
                baseAreaId: rec.area_id.replace(/_\d+$/, ""),
                scores: data.scores ?? [],
                followUps: data.followUps ?? [],
              }))
          )
        );
        return analyzeAll.then((areas) => {
          setAnalysis({ areas });
        });
      })
      .catch((e) => {
        setAnalysisError(e?.message ?? "Analysis failed");
      })
      .finally(() => {
        setAnalysisLoading(false);
      });
  }, [screen, followUpBlockContext, inspectionId]);

  useEffect(() => {
    const stored = sessionStorage.getItem(`inspection-${inspectionId}`);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setInitialState(data);
        setUnitConfigs(data.unitConfigs ?? {});
        return;
      } catch {
        // ignore
      }
    }
    if (!inspectionId.startsWith("demo-")) {
      setInitialState("loading");
      fetch(`/api/inspections/${inspectionId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.selectedUnitIds) {
            setInitialState(data);
            setUnitConfigs(data.unitConfigs ?? {});
          } else {
            setInitialState(null);
          }
        })
        .catch(() => setInitialState(null));
    }
  }, [inspectionId]);

  const inspectionData = initialState && initialState !== "loading" ? initialState : null;
  const selectedUnitIds = inspectionData?.selectedUnitIds ?? [];
  const mergedUnitConfigs = Object.keys(unitConfigs).length ? unitConfigs : (inspectionData?.unitConfigs ?? {});
  const includeSharedAreas = inspectionData?.includeSharedAreas !== false;
  const blocks = deal ? buildBlocks(deal, selectedUnitIds, mergedUnitConfigs, includeSharedAreas) : [];

  useEffect(() => {
    if (
      screen === "inspection" &&
      blockIndex === 0 &&
      areaIndex === 0 &&
      blocks.length > 0 &&
      blocks[0]?.type === "unit" &&
      !firstUnitConfigShownRef.current
    ) {
      firstUnitConfigShownRef.current = true;
      setConfigTargetBlockIndex(0);
      setScreen("unit_config");
    }
  }, [screen, blockIndex, areaIndex, blocks.length, blocks]);

  const currentBlock = blocks[blockIndex];
  const currentAreas = currentBlock?.areas ?? [];
  const currentArea = currentAreas[areaIndex];
  const currentApt =
    currentBlock?.type === "unit" && currentBlock.unitId
      ? deal?.apartments.find((a) => a.id === currentBlock.unitId)
      : null;

  const baseAreaId = currentArea ? getBaseAreaId(currentArea.id) : "";
  const rawQuestions = baseAreaId ? (BASE_QUESTIONS[baseAreaId] ?? []) : [];
  const baseQuestions =
    currentBlock?.type === "shared"
      ? rawQuestions.filter((q) => q.category !== "accuracy")
      : rawQuestions;
  const deepDiveCacheKey = `${blockIndex}-${areaIndex}`;
  const deepDiveQuestions = deepDiveCache[deepDiveCacheKey] ?? [];
  const areaNeedsDeepDives =
    (currentBlock?.type === "unit" && hasIssuesForArea(baseAreaId, currentBlock?.issues ?? [])) ||
    (currentBlock?.type === "shared" && hasIssuesForAreaFromFocusAreas(baseAreaId, deal?.focus_areas ?? []));
  const deepDiveLoading = areaNeedsDeepDives && !(deepDiveCacheKey in deepDiveCache);

  useEffect(() => {
    const ready = initialState && initialState !== "loading" && deal && blocks.length > 0;
    if (!ready || deepDiveFetchedRef.current === inspectionId) return;
    deepDiveFetchedRef.current = inspectionId;

    const toFetch: { key: string; body: { type: "unit"; areaId: string; issues: string[] } | { type: "shared"; areaId: string; focusAreas: { category: string; issues: string[] }[] } }[] = [];
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      for (let ai = 0; ai < block.areas.length; ai++) {
        const key = `${bi}-${ai}`;
        const area = block.areas[ai];
        const areaId = getBaseAreaId(area.id);
        if (block.type === "unit" && hasIssuesForArea(areaId, block.issues ?? [])) {
          toFetch.push({ key, body: { type: "unit", areaId, issues: block.issues! } });
        } else if (block.type === "shared" && hasIssuesForAreaFromFocusAreas(areaId, deal.focus_areas)) {
          toFetch.push({ key, body: { type: "shared", areaId, focusAreas: deal.focus_areas } });
        }
      }
    }

    toFetch.forEach(({ key, body }) => {
      fetch("/api/generate-deep-dives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((data) =>
          setDeepDiveCache((prev) => ({ ...prev, [key]: data.questions ?? [] }))
        )
        .catch(() => setDeepDiveCache((prev) => ({ ...prev, [key]: [] })));
    });
  }, [inspectionId, deal?.id, initialState, blocks.length]);

  const totalAreas = blocks.reduce((s, b) => s + b.areas.length, 0);
  const completedAreas =
    blocks.slice(0, blockIndex).reduce((s, b) => s + b.areas.length, 0) +
    areaIndex;

  const canGoBack = areaIndex > 0 || blockIndex > 0;

  const handleNext = async () => {
    if (recorder.blob) {
      const key = `${currentBlock?.unitId ?? "shared"}-${currentArea?.id}`;
      recordingsRef.current.set(key, {
        blob: recorder.blob,
        durationSeconds: recorder.durationSeconds,
      });
    }
    const { areaRecordingId } = await uploadAreaData();
    recorder.reset();
    Object.values(photosByQuestion).flat().forEach((p) => URL.revokeObjectURL(p.url));
    setPhotosByQuestion({});

    if (areaIndex < currentAreas.length - 1) {
      setAreaIndex(areaIndex + 1);
    } else {
      setFollowUpBlockContext({
        scope: currentBlock?.type === "shared" ? "shared" : "unit",
        apartmentId: currentBlock?.type === "unit" ? currentBlock.unitId ?? null : null,
      });
      setAnalysis(null);
      setAnalysisError(null);
      setFollowUpAudio({});
      setFollowUpPhotos({});
      setScreen("followup");
    }
  };

  const uploadAreaData = async (): Promise<{ areaRecordingId?: string }> => {
    if (inspectionId.startsWith("demo-")) return {};
    const hasAudio = !!recorder.blob;
    const hasPhotos = Object.values(photosByQuestion).flat().length > 0;

    const formData = new FormData();
    if (hasAudio) {
      formData.append("audio", recorder.blob!, "recording.webm");
      formData.append("duration_seconds", String(recorder.durationSeconds));
    }
    formData.append("area_id", currentArea?.id ?? "");
    formData.append("area_name", currentArea?.name ?? "");
    formData.append(
      "scope",
      currentBlock?.type === "shared" ? "shared" : "unit"
    );
    if (currentBlock?.type === "unit" && currentBlock.unitId) {
      formData.append("apartment_id", currentBlock.unitId);
    }
    Object.entries(photosByQuestion).forEach(([questionId, photos]) => {
      photos.forEach((photo, i) => {
        formData.append("photos", photo.blob, `photo-${questionId}-${i}.jpg`);
        formData.append("photo_question_ids", questionId);
      });
    });

    try {
      const res = await fetch(`/api/inspections/${inspectionId}/recordings`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      return { areaRecordingId: data?.areaRecordingId };
    } catch (e) {
      console.error("Failed to upload area data:", e);
      return {};
    }
  };

  const handleBack = async () => {
    if (recorder.blob) {
      const key = `${currentBlock?.unitId ?? "shared"}-${currentArea?.id}`;
      recordingsRef.current.set(key, {
        blob: recorder.blob,
        durationSeconds: recorder.durationSeconds,
      });
    }
    await uploadAreaData();
    recorder.reset();
    Object.values(photosByQuestion).flat().forEach((p) => URL.revokeObjectURL(p.url));
    setPhotosByQuestion({});

    if (areaIndex > 0) {
      setAreaIndex(areaIndex - 1);
    } else if (blockIndex > 0) {
      const prevBlock = blocks[blockIndex - 1];
      setBlockIndex(blockIndex - 1);
      setAreaIndex(prevBlock.areas.length - 1);
    }
  };

  const handleFollowUpContinue = async () => {
    if (analysis && !inspectionId.startsWith("demo-")) {
      const hasAudio = Object.keys(followUpAudio).length > 0;
      const hasPhotos = Object.values(followUpPhotos).flat().length > 0;
      if (hasAudio || hasPhotos) {
        try {
          for (const area of analysis.areas) {
            const formData = new FormData();
            let hasData = false;
            for (const f of area.followUps) {
              const key = `${area.areaRecordingId}::${f.question_id}`;
              const audio = followUpAudio[key];
              if (audio?.blob) {
                formData.append(`audio_${f.question_id}`, audio.blob, "recording.webm");
                formData.append(`duration_${f.question_id}`, String(audio.durationSeconds));
                hasData = true;
              }
              const photos = followUpPhotos[key] ?? [];
              photos.forEach((p, i) => {
                formData.append("photos", p.blob, `photo-${f.question_id}-${i}.jpg`);
                formData.append("photo_question_ids", f.question_id);
                hasData = true;
              });
            }
            if (!hasData) continue;
            await fetch(`/api/inspections/${inspectionId}/recordings/${area.areaRecordingId}/scores`, {
              method: "PATCH",
              body: formData,
            });
          }
        } catch (e) {
          console.error("Failed to save follow-up responses:", e);
        }
      }
    }

    if (blockIndex < blocks.length - 1) {
      const nextBlock = blocks[blockIndex + 1];
      if (nextBlock?.type === "unit") {
        setConfigTargetBlockIndex(blockIndex + 1);
        setScreen("unit_config");
      } else {
        setBlockIndex(blockIndex + 1);
        setAreaIndex(0);
        setScreen("inspection");
      }
    } else {
      setScreen("freestyle");
    }
  };

  const updateUnitConfig = (
    unitId: string,
    field: "bedrooms" | "bathrooms" | "living_rooms" | "kitchen" | "balcony",
    delta: number
  ) => {
    setUnitConfigs((prev) => {
      const current = prev[unitId] ?? { bedrooms: 1, bathrooms: 1, living_rooms: 0, kitchen: 1, balcony: 0 };
      const limits: [number, number] =
        field === "living_rooms" || field === "kitchen" || field === "balcony" ? [0, 5] : [1, 5];
      const defaults = { living_rooms: 0, kitchen: 1, balcony: 0, bedrooms: 1, bathrooms: 1 };
      const newVal = Math.max(
        limits[0],
        Math.min(limits[1], (current[field] ?? defaults[field]) + delta)
      );
      return { ...prev, [unitId]: { ...current, [field]: newVal } };
    });
  };

  const persistUnitConfigs = async (configs: Record<string, { bedrooms: number; bathrooms: number; living_rooms: number; kitchen: number; balcony: number }>) => {
    if (inspectionId.startsWith("demo-")) {
      sessionStorage.setItem(
        `inspection-${inspectionId}`,
        JSON.stringify({ selectedUnitIds, unitConfigs: configs, includeSharedAreas })
      );
      return;
    }
    try {
      await fetch(`/api/inspections/${inspectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitConfigs: configs }),
      });
    } catch (e) {
      console.error("Failed to persist unit config:", e);
    }
  };

  const handleUnitConfigContinue = () => {
    const targetIdx = configTargetBlockIndex;
    if (targetIdx == null) return;
    const block = blocks[targetIdx];
    if (block?.type !== "unit" || !block.unitId) return;
    const config = mergedUnitConfigs[block.unitId] ?? { bedrooms: 1, bathrooms: 1, living_rooms: 0, kitchen: 1, balcony: 0 };
    const nextConfigs = { ...mergedUnitConfigs, [block.unitId]: config };
    setUnitConfigs(nextConfigs);
    persistUnitConfigs(nextConfigs);
    setBlockIndex(targetIdx);
    setAreaIndex(0);
    setConfigTargetBlockIndex(null);
    setScreen("inspection");
  };

  const freestyleRecorder = useVoiceRecorder();
  const [freestylePhotos, setFreestylePhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const freestylePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [freestyleSubmitting, setFreestyleSubmitting] = useState(false);
  const [freestyleDealEntries, setFreestyleDealEntries] = useState<{ audio?: { blob: Blob; durationSeconds: number }; photos: { blob: Blob; url: string }[] }[]>([]);
  const [freestyleUnitEntries, setFreestyleUnitEntries] = useState<{ apartmentId: string; unitName: string; audio?: { blob: Blob; durationSeconds: number }; photos: { blob: Blob; url: string }[] }[]>([]);
  const [freestyleSelectedUnit, setFreestyleSelectedUnit] = useState<string | null>(null);

  const uploadOneFreestyle = async (
    areaId: string,
    areaName: string,
    apartmentId: string | null,
    audio: { blob: Blob; durationSeconds: number } | undefined,
    photos: { blob: Blob }[]
  ): Promise<void> => {
    if (inspectionId.startsWith("demo-")) return;
    if (!audio && photos.length === 0) return;

    const formData = new FormData();
    if (audio) {
      formData.append("audio", audio.blob, "recording.webm");
      formData.append("duration_seconds", String(audio.durationSeconds));
    }
    formData.append("area_id", areaId);
    formData.append("area_name", areaName);
    formData.append("scope", "freestyle");
    if (apartmentId) formData.append("apartment_id", apartmentId);
    photos.forEach((p, i) => {
      formData.append("photos", p.blob, `freestyle-${i}.jpg`);
      formData.append("photo_question_ids", "freestyle");
    });

    try {
      await fetch(`/api/inspections/${inspectionId}/recordings`, {
        method: "POST",
        body: formData,
      });
    } catch (e) {
      console.error("Failed to upload freestyle notes:", e);
    }
  };

  const addFreestyleDealEntry = () => {
    if (!freestyleRecorder.blob && freestylePhotos.length === 0) return;
    setFreestyleDealEntries((prev) => [
      ...prev,
      {
        audio: freestyleRecorder.blob ? { blob: freestyleRecorder.blob, durationSeconds: freestyleRecorder.durationSeconds } : undefined,
        photos: [...freestylePhotos],
      },
    ]);
    freestyleRecorder.reset();
    freestylePhotos.forEach((p) => URL.revokeObjectURL(p.url));
    setFreestylePhotos([]);
  };

  const addFreestyleUnitEntry = () => {
    const aptId = freestyleSelectedUnit;
    if (!aptId || (!freestyleRecorder.blob && freestylePhotos.length === 0)) return;
    const apt = deal?.apartments.find((a) => a.id === aptId);
    setFreestyleUnitEntries((prev) => [
      ...prev,
      {
        apartmentId: aptId,
        unitName: apt ? `Unit ${apt.apartment_sku}` : aptId,
        audio: freestyleRecorder.blob ? { blob: freestyleRecorder.blob, durationSeconds: freestyleRecorder.durationSeconds } : undefined,
        photos: [...freestylePhotos],
      },
    ]);
    freestyleRecorder.reset();
    freestylePhotos.forEach((p) => URL.revokeObjectURL(p.url));
    setFreestylePhotos([]);
  };

  const uploadAllFreestyle = async (): Promise<void> => {
    const hasCurrent = !!freestyleRecorder.blob || freestylePhotos.length > 0;
    const currentEntry = hasCurrent
      ? {
          audio: freestyleRecorder.blob ? { blob: freestyleRecorder.blob, durationSeconds: freestyleRecorder.durationSeconds } : undefined,
          photos: [...freestylePhotos],
        }
      : null;

    const allDeal = [...freestyleDealEntries];
    if (currentEntry && !freestyleSelectedUnit) allDeal.push(currentEntry);

    const allUnit = [...freestyleUnitEntries];
    if (currentEntry && freestyleSelectedUnit) {
      const apt = deal?.apartments.find((a) => a.id === freestyleSelectedUnit);
      allUnit.push({
        apartmentId: freestyleSelectedUnit,
        unitName: apt ? `Unit ${apt.apartment_sku}` : freestyleSelectedUnit,
        audio: currentEntry.audio,
        photos: currentEntry.photos,
      });
    }

    for (const entry of allDeal) {
      const areaId = `freestyle_deal_${crypto.randomUUID()}`;
      const photos = entry.photos.map((p: { blob: Blob }) => ({ blob: p.blob }));
      await uploadOneFreestyle(areaId, "Overall Deal Notes", null, entry.audio, photos);
    }

    for (const entry of allUnit) {
      const areaId = `freestyle_unit_${crypto.randomUUID()}`;
      await uploadOneFreestyle(
        areaId,
        `Additional Notes (${entry.unitName})`,
        entry.apartmentId,
        entry.audio,
        entry.photos.map((p) => ({ blob: p.blob }))
      );
    }
  };

  const completeAndFinish = async () => {
    setFreestyleSubmitting(true);
    setReportError(null);
    await uploadAllFreestyle();
    if (!inspectionId.startsWith("demo-")) {
      try {
        const res = await fetch(`/api/inspections/${inspectionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ complete: true }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          reportError?: string;
        };
        if (json.reportError) {
          setReportError(json.reportError);
        } else if (!res.ok) {
          setReportError(
            res.status === 504
              ? "Report generation timed out (Vercel Hobby limit). Upgrade to Pro for longer runs."
              : `Request failed (${res.status}). Report may not have been generated.`
          );
        }
      } catch (e) {
        console.error("Failed to complete inspection:", e);
        setReportError("Connection failed. Inspection saved, but report may not have been generated.");
      }
    }
    setFreestyleSubmitting(false);
    setScreen("done");
  };

  const handleFreestyleSubmit = () => completeAndFinish();
  const handleFreestyleSkip = () => completeAndFinish();

  const handleStartNew = () => {
    sessionStorage.removeItem(`inspection-${inspectionId}`);
    router.push("/");
  };

  if (initialState === "loading") {
    return (
      <div className="mx-auto flex min-h-screen max-w-[430px] items-center justify-center">
        <p className="text-[var(--color-text-muted)]">Loading inspection…</p>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[430px] flex-col items-center justify-center gap-4 px-6">
        <p className="text-[var(--color-text-muted)]">Deal not found</p>
        <Link
          href="/"
          className="font-semibold text-[var(--color-accent)] underline"
        >
          Back to deals
        </Link>
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[430px] flex-col items-center justify-center gap-4 px-6">
        <p className="text-[var(--color-text-muted)]">No areas selected</p>
        <Link
          href={`/inspect/${deal.id}`}
          className="font-semibold text-[var(--color-accent)] underline"
        >
          Select units
        </Link>
      </div>
    );
  }

  const configTargetBlock = configTargetBlockIndex != null ? blocks[configTargetBlockIndex] : null;
  const configTargetUnitId = configTargetBlock?.type === "unit" ? configTargetBlock.unitId : null;
  const configTargetUnitName = configTargetBlock?.unitName ?? "";
  const unitConfigValues = configTargetUnitId
    ? (mergedUnitConfigs[configTargetUnitId] ?? { bedrooms: 1, bathrooms: 1, living_rooms: 0, kitchen: 1, balcony: 0 })
    : null;

  if (screen === "unit_config" && configTargetBlock && configTargetUnitId && unitConfigValues) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[430px] flex-col bg-white">
        <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-white px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Unit Configuration
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--color-primary)]">
            {configTargetUnitName}
          </h1>
        </header>
        <main className="flex-1 px-6 py-6 pb-32">
          <p className="mb-6 text-[15px] leading-relaxed text-[var(--color-text-muted)]">
            How many rooms does this unit have? You can adjust this before inspecting each unit.
          </p>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-light)] p-5">
              <span className="text-[15px] font-medium text-[var(--color-primary)]">Bedrooms</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => updateUnitConfig(configTargetUnitId, "bedrooms", -1)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-xl font-medium transition-colors hover:bg-[var(--color-bg-light)]"
                >
                  −
                </button>
                <span className="min-w-[28px] text-center text-[17px] font-semibold">{unitConfigValues.bedrooms}</span>
                <button
                  type="button"
                  onClick={() => updateUnitConfig(configTargetUnitId, "bedrooms", 1)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-xl font-medium transition-colors hover:bg-[var(--color-bg-light)]"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-light)] p-5">
              <span className="text-[15px] font-medium text-[var(--color-primary)]">Bathrooms</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => updateUnitConfig(configTargetUnitId, "bathrooms", -1)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-xl font-medium transition-colors hover:bg-[var(--color-bg-light)]"
                >
                  −
                </button>
                <span className="min-w-[28px] text-center text-[17px] font-semibold">{unitConfigValues.bathrooms}</span>
                <button
                  type="button"
                  onClick={() => updateUnitConfig(configTargetUnitId, "bathrooms", 1)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-xl font-medium transition-colors hover:bg-[var(--color-bg-light)]"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-light)] p-5">
              <span className="text-[15px] font-medium text-[var(--color-primary)]">Living rooms</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => updateUnitConfig(configTargetUnitId, "living_rooms", -1)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-xl font-medium transition-colors hover:bg-[var(--color-bg-light)]"
                >
                  −
                </button>
                <span className="min-w-[28px] text-center text-[17px] font-semibold">{unitConfigValues.living_rooms}</span>
                <button
                  type="button"
                  onClick={() => updateUnitConfig(configTargetUnitId, "living_rooms", 1)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-xl font-medium transition-colors hover:bg-[var(--color-bg-light)]"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-light)] p-5">
              <span className="text-[15px] font-medium text-[var(--color-primary)]">Kitchen</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => updateUnitConfig(configTargetUnitId, "kitchen", -1)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-xl font-medium transition-colors hover:bg-[var(--color-bg-light)]"
                >
                  −
                </button>
                <span className="min-w-[28px] text-center text-[17px] font-semibold">{unitConfigValues.kitchen ?? 1}</span>
                <button
                  type="button"
                  onClick={() => updateUnitConfig(configTargetUnitId, "kitchen", 1)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-xl font-medium transition-colors hover:bg-[var(--color-bg-light)]"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-light)] p-5">
              <span className="text-[15px] font-medium text-[var(--color-primary)]">Balcony / Outdoor</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => updateUnitConfig(configTargetUnitId, "balcony", -1)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-xl font-medium transition-colors hover:bg-[var(--color-bg-light)]"
                >
                  −
                </button>
                <span className="min-w-[28px] text-center text-[17px] font-semibold">{unitConfigValues.balcony ?? 0}</span>
                <button
                  type="button"
                  onClick={() => updateUnitConfig(configTargetUnitId, "balcony", 1)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-xl font-medium transition-colors hover:bg-[var(--color-bg-light)]"
                >
                  +
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleUnitConfigContinue}
            className="mt-8 w-full rounded-xl bg-[var(--color-accent)] py-4 text-[15px] font-semibold text-[var(--color-primary)]"
          >
            Continue to inspection
          </button>
        </main>
      </div>
    );
  }

  if (screen === "followup") {
    return (
      <div className="mx-auto flex min-h-screen max-w-[430px] flex-col bg-white">
        <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-white px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            {currentBlock?.unitName} Complete
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--color-primary)]">
            Follow-up Questions
          </h1>
        </header>
        <main className="flex-1 px-6 py-6 pb-32">
          {analysisLoading && (
            <div className="mb-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-light)] p-6 text-center">
              <p className="text-[15px] font-medium text-[var(--color-text-muted)]">
                Analyzing transcript…
              </p>
            </div>
          )}
          {analysisError && (
            <div className="mb-6 rounded-2xl border border-[var(--color-error)] bg-[#fef2f2] p-6 text-center">
              <p className="text-[15px] font-medium text-[var(--color-error)]">
                {analysisError}
              </p>
            </div>
          )}
          {analysis && !analysisLoading && (
            <>
              {analysis.areas.map((area) => (
                <div key={area.areaRecordingId} className="mb-8">
                  <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-primary)]">
                    {area.areaName}
                  </h3>
                  {area.scores.length > 0 && (
                    <div className="mb-4">
                      <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                        Scores
                      </h4>
                      <div className="space-y-2">
                        {area.scores.map((s) => {
                          const q = (BASE_QUESTIONS[area.baseAreaId] ?? []).find((x) => x.id === s.question_id);
                          return (
                            <div
                              key={s.question_id}
                              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-light)] px-4 py-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[13px] font-medium text-[var(--color-primary)]">
                                  {q?.question ?? s.question_id}
                                </span>
                                <span className="flex-shrink-0 text-[13px] font-semibold text-[var(--color-primary)]">
                                  {s.score != null ? `${s.score}/10` : "—"}
                                </span>
                              </div>
                              {s.details && (
                                <p className="mt-1.5 text-[13px] text-[var(--color-text-muted)]">
                                  {s.details}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {area.followUps.length > 0 && (
                    <div>
                      <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                        Follow-up questions
                      </h4>
                      <input
                        ref={followupPhotoInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          const key = activeFollowUpKeyRef.current;
                          if (file && key) {
                            setFollowUpPhotos((prev) => ({
                              ...prev,
                              [key]: [...(prev[key] ?? []), { blob: file, url: URL.createObjectURL(file) }],
                            }));
                            activeFollowUpKeyRef.current = null;
                          }
                          e.target.value = "";
                        }}
                      />
                      <div className="space-y-4">
                        {area.followUps.map((f) => {
                          const answerKey = `${area.areaRecordingId}::${f.question_id}`;
                          const audio = followUpAudio[answerKey];
                          const photos = followUpPhotos[answerKey] ?? [];
                          const isRecordingThis = activeFollowUpKeyRef.current === answerKey;
                          const recorderActive = followupRecorder.status !== "idle" && isRecordingThis;
                          return (
                            <div
                              key={f.question_id}
                              className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4"
                            >
                              <p className="mb-3 text-[15px] font-medium text-[var(--color-primary)]">
                                {f.question}
                              </p>
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  {followupRecorder.status !== "idle" && isRecordingThis ? (
                                    <>
                                      <span className="text-[15px] font-semibold tabular-nums">
                                        {formatDuration(followupRecorder.durationSeconds)}
                                      </span>
                                      {followupRecorder.status === "recording" && (
                                        <button
                                          type="button"
                                          onClick={followupRecorder.pause}
                                          className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] font-medium"
                                        >
                                          Pause
                                        </button>
                                      )}
                                      {followupRecorder.status === "paused" && (
                                        <button
                                          type="button"
                                          onClick={followupRecorder.resume}
                                          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium"
                                        >
                                          Resume
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          followupRecorder.stop();
                                          activeFollowUpKeyRef.current = answerKey;
                                        }}
                                        className="rounded-lg bg-[var(--color-error)] px-3 py-1.5 text-[13px] font-medium text-white"
                                      >
                                        Stop
                                      </button>
                                    </>
                                  ) : audio ? (
                                    <>
                                      <span className="text-[13px] text-[var(--color-success)]">
                                        ✓ Recorded {formatDuration(audio.durationSeconds)}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setFollowUpAudio((prev) => {
                                            const next = { ...prev };
                                            delete next[answerKey];
                                            return next;
                                          })
                                        }
                                        className="text-[13px] font-medium text-[var(--color-error)] underline"
                                      >
                                        Re-record
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={followupRecorder.status !== "idle"}
                                      onClick={() => {
                                        activeFollowUpKeyRef.current = answerKey;
                                        followupRecorder.start();
                                      }}
                                      className="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-[14px] font-semibold disabled:opacity-50"
                                    >
                                      Record answer
                                    </button>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {photos.map((photo, i) => (
                                    <div key={i} className="relative">
                                      <img src={photo.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                                      <button
                                        type="button"
                                        onClick={() => {
                                          URL.revokeObjectURL(photo.url);
                                          setFollowUpPhotos((prev) => ({
                                            ...prev,
                                            [answerKey]: (prev[answerKey] ?? []).filter((_, idx) => idx !== i),
                                          }));
                                        }}
                                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-error)] text-[10px] text-white"
                                        aria-label="Remove photo"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      activeFollowUpKeyRef.current = answerKey;
                                      followupPhotoInputRef.current?.click();
                                    }}
                                    className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-[var(--color-border)] text-xl text-[var(--color-text-muted)]"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {analysis.areas.length === 0 && (
                <div className="mb-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-light)] p-6 text-center">
                  <p className="text-[15px] font-medium text-[var(--color-text-muted)]">
                    No recordings for this block.
                  </p>
                </div>
              )}
            </>
          )}
          {!analysis && !analysisLoading && !analysisError && !followUpBlockContext && (
            <div className="mb-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-light)] p-6 text-center">
              <p className="text-[15px] font-medium text-[var(--color-text-muted)]">
                No recording for this block.
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => handleFollowUpContinue()}
            disabled={analysisLoading}
            className="mt-6 w-full rounded-xl bg-[var(--color-accent)] py-4 text-[15px] font-semibold text-[var(--color-primary)] disabled:opacity-50"
          >
            Continue to{" "}
            {blockIndex < blocks.length - 1
              ? blocks[blockIndex + 1]?.unitName
              : "Freestyle Notes"}
          </button>
        </main>
      </div>
    );
  }

  if (screen === "freestyle") {
    const hasCurrent = !!freestyleRecorder.blob || freestylePhotos.length > 0;
    const canAddDeal = hasCurrent && !freestyleSelectedUnit;
    const canAddUnit = hasCurrent && !!freestyleSelectedUnit;
    const selectedUnitApt = freestyleSelectedUnit ? deal?.apartments.find((a) => a.id === freestyleSelectedUnit) : null;

    return (
      <div className="mx-auto flex min-h-screen max-w-[430px] flex-col bg-white">
        <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-white px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Final Step (Optional)
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--color-primary)]">
            Additional Notes
          </h1>
        </header>
        <main className="flex-1 px-6 py-6 pb-48">
          <div className="mb-6 rounded-2xl bg-[var(--color-bg-light)] p-6">
            <h3 className="mb-2 text-lg font-semibold text-[var(--color-primary)]">
              Improvement Suggestions
            </h3>
            <p className="mb-0 text-sm leading-relaxed text-[var(--color-text-muted)]">
              Add optional voice notes or photos. You can add notes for the overall deal and for specific units.
            </p>
          </div>

          {/* Overall deal section */}
          <div className="mb-8">
            <h4 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Overall deal
            </h4>
            <p className="mb-3 text-sm text-[var(--color-text-muted)]">
              Notes about the deal in general (building, location, overall impression).
            </p>
            {freestyleDealEntries.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {freestyleDealEntries.map((_, i) => (
                  <span key={i} className="inline-flex items-center rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-primary)]">
                    ✓ Note {i + 1}
                  </span>
                ))}
              </div>
            )}
            <div className="mb-3 flex gap-2">
              <div className="flex-1">
                {freestyleRecorder.status !== "idle" && !freestyleSelectedUnit ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold tabular-nums">{formatDuration(freestyleRecorder.durationSeconds)}</span>
                    {freestyleRecorder.status === "recording" && (
                      <>
                        <button type="button" onClick={freestyleRecorder.pause} className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] font-medium">Pause</button>
                        <button type="button" onClick={freestyleRecorder.stop} className="rounded-lg bg-[var(--color-error)] px-3 py-1.5 text-[13px] font-medium text-white">Stop</button>
                      </>
                    )}
                    {freestyleRecorder.status === "paused" && (
                      <>
                        <button type="button" onClick={freestyleRecorder.resume} className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium">Resume</button>
                        <button type="button" onClick={freestyleRecorder.stop} className="rounded-lg bg-[var(--color-error)] px-3 py-1.5 text-[13px] font-medium text-white">Stop</button>
                      </>
                    )}
                    {freestyleRecorder.status === "recorded" && (
                      <>
                        <span className="text-[13px] text-[var(--color-success)]">✓ Recorded</span>
                        <button type="button" onClick={freestyleRecorder.reset} className="text-[13px] font-medium text-[var(--color-error)] underline">Re-record</button>
                      </>
                    )}
                  </div>
                ) : !freestyleSelectedUnit ? (
                  <button
                    type="button"
                    onClick={freestyleRecorder.start}
                    className="rounded-lg border-2 border-dashed border-[var(--color-border)] bg-white px-4 py-3 text-[15px] font-medium text-[var(--color-primary)]"
                  >
                    Record
                  </button>
                ) : null}
              </div>
              {!freestyleSelectedUnit && (
                <button
                  type="button"
                  disabled={!canAddDeal}
                  onClick={addFreestyleDealEntry}
                  className="rounded-xl bg-[var(--color-accent)] px-4 py-3 text-[14px] font-semibold text-[var(--color-primary)] disabled:opacity-50"
                >
                  Add to overall
                </button>
              )}
            </div>
          </div>

          {/* Unit-specific section (only when units were selected) */}
          {selectedUnitIds.length > 0 && (
          <div className="mb-8">
            <h4 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Unit-specific notes
            </h4>
            <p className="mb-3 text-sm text-[var(--color-text-muted)]">
              Add notes for specific apartments. You can add multiple entries per unit.
            </p>
            {freestyleUnitEntries.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {Object.entries(
                  freestyleUnitEntries.reduce<Record<string, number>>((acc, e) => {
                    acc[e.unitName] = (acc[e.unitName] ?? 0) + 1;
                    return acc;
                  }, {})
                ).map(([name, count]) => (
                  <span key={name} className="inline-flex items-center rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-primary)]">
                    ✓ {name}: {count} note{count !== 1 ? "s" : ""}
                  </span>
                ))}
              </div>
            )}
            <div className="mb-3">
              <label className="mb-2 block text-[13px] font-medium text-[var(--color-primary)]">Select unit</label>
              <select
                value={freestyleSelectedUnit ?? ""}
                onChange={(e) => setFreestyleSelectedUnit(e.target.value || null)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-white px-4 py-3 text-[15px]"
              >
                <option value="">— Choose unit —</option>
                {selectedUnitIds.map((id) => {
                  const apt = deal?.apartments.find((a) => a.id === id);
                  return (
                    <option key={id} value={id}>
                      Unit {apt?.apartment_sku ?? id}
                    </option>
                  );
                })}
              </select>
            </div>
            {freestyleSelectedUnit && (
              <div className="mb-3 flex gap-2">
                <div className="flex-1">
                  {freestyleRecorder.status !== "idle" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold tabular-nums">{formatDuration(freestyleRecorder.durationSeconds)}</span>
                      {freestyleRecorder.status === "recording" && (
                        <>
                          <button type="button" onClick={freestyleRecorder.pause} className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] font-medium">Pause</button>
                          <button type="button" onClick={freestyleRecorder.stop} className="rounded-lg bg-[var(--color-error)] px-3 py-1.5 text-[13px] font-medium text-white">Stop</button>
                        </>
                      )}
                      {freestyleRecorder.status === "paused" && (
                        <>
                          <button type="button" onClick={freestyleRecorder.resume} className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium">Resume</button>
                          <button type="button" onClick={freestyleRecorder.stop} className="rounded-lg bg-[var(--color-error)] px-3 py-1.5 text-[13px] font-medium text-white">Stop</button>
                        </>
                      )}
                      {freestyleRecorder.status === "recorded" && (
                        <>
                          <span className="text-[13px] text-[var(--color-success)]">✓ Recorded</span>
                          <button type="button" onClick={freestyleRecorder.reset} className="text-[13px] font-medium text-[var(--color-error)] underline">Re-record</button>
                        </>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={freestyleRecorder.start}
                      className="rounded-lg border-2 border-dashed border-[var(--color-border)] bg-white px-4 py-3 text-[15px] font-medium text-[var(--color-primary)]"
                    >
                      Record for {selectedUnitApt ? `Unit ${selectedUnitApt.apartment_sku}` : "unit"}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!canAddUnit}
                  onClick={addFreestyleUnitEntry}
                  className="rounded-xl bg-[var(--color-accent)] px-4 py-3 text-[14px] font-semibold text-[var(--color-primary)] disabled:opacity-50"
                >
                  Add for unit
                </button>
              </div>
            )}
          </div>
          )}

          {/* Shared photos */}
          <div className="mb-6">
            <h4 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Photos
            </h4>
            <input
              ref={freestylePhotoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setFreestylePhotos((prev) => [...prev, { blob: file, url: URL.createObjectURL(file) }]);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              {freestylePhotos.map((photo, i) => (
                <div key={i} className="relative">
                  <img src={photo.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(photo.url);
                      setFreestylePhotos((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-error)] text-[10px] text-white"
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => freestylePhotoInputRef.current?.click()}
                className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-[var(--color-border)] text-xl text-[var(--color-text-muted)]"
              >
                +
              </button>
            </div>
            <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
              Photos are attached to your current note (overall or selected unit).
            </p>
          </div>

          <button
            type="button"
            disabled={freestyleSubmitting}
            onClick={handleFreestyleSubmit}
            className="mb-3 w-full rounded-xl bg-[var(--color-accent)] py-4 text-[15px] font-semibold text-[var(--color-primary)] disabled:opacity-50"
          >
            {freestyleSubmitting ? "Submitting…" : "Submit Inspection"}
          </button>
          <button
            type="button"
            disabled={freestyleSubmitting}
            onClick={handleFreestyleSkip}
            className="w-full rounded-xl border border-[var(--color-border)] py-4 text-[15px] font-semibold text-[var(--color-text-muted)] disabled:opacity-50"
          >
            Skip and Submit
          </button>
        </main>
      </div>
    );
  }

  if (screen === "done") {
    return (
      <div className="mx-auto flex min-h-screen max-w-[430px] flex-col bg-white">
        <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-white px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Complete
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--color-primary)]">
            Inspection Done
          </h1>
        </header>
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#dcfce7] text-3xl text-[var(--color-success)]">
            ✓
          </div>
          <h2 className="mb-3 text-center text-2xl font-bold text-[var(--color-primary)]">
            Inspection Submitted
          </h2>
          <p className="mb-8 max-w-sm text-center text-[15px] leading-relaxed text-[var(--color-text-muted)]">
            {reportError
              ? "Inspection saved, but the Notion report could not be generated."
              : "Your report has been generated and added to the Deal 1-pager in Notion."}
          </p>
          {reportError && (
            <p className="mb-6 max-w-sm rounded-lg border border-[var(--color-error)] bg-[#fef2f2] px-4 py-3 text-[13px] text-[var(--color-error)]">
              {reportError}
            </p>
          )}
          <button
            type="button"
            onClick={handleStartNew}
            className="w-full max-w-[300px] rounded-xl bg-[var(--color-accent)] py-4 text-[15px] font-semibold text-[var(--color-primary)]"
          >
            Start New Inspection
          </button>
        </main>
      </div>
    );
  }

  // Inspection screen
  return (
    <div className="mx-auto flex min-h-screen max-w-[430px] flex-col bg-white">
      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-white px-6 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          Area {completedAreas + 1} of {totalAreas}
        </p>
        <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--color-primary)]">
          {currentArea?.name}
        </h1>
      </header>

      <main className="flex-1 px-6 py-6 pb-48">
        <div className="mb-5 flex gap-1">
          {Array.from({ length: totalAreas }).map((_, i) => (
            <div
              key={i}
              className="h-0.5 flex-1 rounded"
              style={{
                backgroundColor:
                  i < completedAreas
                    ? "var(--color-success)"
                    : i === completedAreas
                      ? "var(--color-accent)"
                      : "var(--color-border)",
              }}
            />
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-start gap-2">
          <span className="inline-flex max-w-full break-words rounded-lg bg-[var(--color-bg-light)] px-3.5 py-2 text-[13px] font-semibold text-[var(--color-primary)]">
            {currentBlock?.unitName}
          </span>
          {currentBlock?.type === "unit" &&
            currentApt?.issues &&
            currentApt.issues.length > 0 && (
              <span className="inline-block rounded-md bg-[#fef2f2] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-error)]">
                {currentApt.issues.length} known issues
              </span>
            )}
        </div>

        {(() => {
          if (currentBlock?.type !== "unit" || !currentApt) return null;
          const bookingUrl = currentApt.booking_com_url;
          const airbnbUrl = currentApt.airbnb_url;
          if (!bookingUrl && !airbnbUrl) return null;
          return (
            <div className="mb-6 flex flex-wrap justify-start gap-2">
              {bookingUrl && (
                <a
                  href={bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-lg border border-[#003580] bg-[#003580] px-4 py-2.5 text-[13px] font-semibold text-white no-underline transition-opacity hover:opacity-90"
                >
                  booking.com
                </a>
              )}
              {airbnbUrl && (
                <a
                  href={airbnbUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-lg border border-[#ff5a5f] bg-[#ff5a5f] px-4 py-2.5 text-[13px] font-semibold text-white no-underline transition-opacity hover:opacity-90"
                >
                  Airbnb
                </a>
              )}
            </div>
          );
        })()}

        <h2 className="mb-6 text-[28px] font-bold tracking-tight text-[var(--color-primary)]">
          {currentArea?.name}
        </h2>

        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            const qId = activeQuestionRef.current;
            if (file && qId) {
              setPhotosByQuestion((prev) => ({
                ...prev,
                [qId]: [...(prev[qId] ?? []), { blob: file, url: URL.createObjectURL(file) }],
              }));
              activeQuestionRef.current = null;
            }
            e.target.value = "";
          }}
        />
        {baseQuestions.map((q) => {
          const questionPhotos = photosByQuestion[q.id] ?? [];
          return (
            <div
              key={q.id}
              className="mb-4 rounded-xl bg-[var(--color-bg-light)] p-4"
            >
              <div className="flex items-start gap-3">
                <div
                  className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                  style={{ backgroundColor: q.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium leading-relaxed text-[var(--color-primary)]">
                    {q.question}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {questionPhotos.map((photo, i) => (
                      <div key={i} className="relative">
                        <img
                          src={photo.url}
                          alt=""
                          className="h-16 w-16 rounded-lg object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            URL.revokeObjectURL(photo.url);
                            setPhotosByQuestion((prev) => ({
                              ...prev,
                              [q.id]: (prev[q.id] ?? []).filter((_, idx) => idx !== i),
                            }));
                          }}
                          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-error)] text-[10px] text-white"
                          aria-label="Remove photo"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        activeQuestionRef.current = q.id;
                        photoInputRef.current?.click();
                      }}
                      className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-[var(--color-border)] text-xl text-[var(--color-text-muted)]"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {(deepDiveLoading || deepDiveQuestions.length > 0) && (
          <div className="mt-6 border-t border-[var(--color-border)] pt-6">
            <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Deep-dive (based on known issues)
            </h3>
            {deepDiveLoading ? (
              <p className="mb-3 text-[13px] text-[var(--color-text-muted)]">Loading questions…</p>
            ) : (
            deepDiveQuestions.map((q, i) => {
              const ddId = `dd_${baseAreaId}_${i}`;
              const questionPhotos = photosByQuestion[ddId] ?? [];
              return (
                <div key={ddId} className="mb-4 rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4">
                  <p className="text-[15px] font-medium leading-relaxed text-[var(--color-primary)]">
                    {q}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {questionPhotos.map((photo, j) => (
                      <div key={j} className="relative">
                        <img src={photo.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                        <button
                          type="button"
                          onClick={() => {
                            URL.revokeObjectURL(photo.url);
                            setPhotosByQuestion((prev) => ({
                              ...prev,
                              [ddId]: (prev[ddId] ?? []).filter((_, idx) => idx !== j),
                            }));
                          }}
                          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-error)] text-[10px] text-white"
                          aria-label="Remove photo"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        activeQuestionRef.current = ddId;
                        photoInputRef.current?.click();
                      }}
                      className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-[var(--color-border)] text-xl text-[var(--color-text-muted)]"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })
            )}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-1/2 flex w-full max-w-[430px] -translate-x-1/2 flex-col border-t border-[var(--color-border)] bg-white p-6 pt-4 shadow-[0_-8px_30px_rgba(0,0,0,0.08)]">
        <p className="mb-1 text-center text-[32px] font-bold tabular-nums tracking-tight text-[var(--color-primary)]">
          {(recorder.status === "recording" || recorder.status === "paused" || recorder.status === "recorded")
            ? formatDuration(recorder.durationSeconds)
            : "0:00"}
        </p>
        <p className="mb-4 text-center text-xs text-[var(--color-text-muted)]">
          {recorder.status === "idle" && "Tap Record to describe this area"}
          {recorder.status === "recording" && "Recording…"}
          {recorder.status === "paused" && "Paused"}
          {recorder.status === "recorded" && "Recorded"}
        </p>
        {recorder.error && (
          <p className="mb-3 text-center text-xs text-[var(--color-error)]">
            {recorder.error}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {recorder.status === "recording" ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={recorder.pause}
                className="flex-1 rounded-xl border border-[var(--color-border)] py-4 text-[15px] font-semibold text-[var(--color-primary)]"
              >
                Pause
              </button>
              <button
                type="button"
                onClick={recorder.stop}
                className="flex-1 rounded-xl bg-[#ef4444] py-4 text-[15px] font-semibold text-white"
              >
                <span className="flex items-center justify-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-white/80 animate-pulse" />
                  Stop
                </span>
              </button>
            </div>
          ) : recorder.status === "paused" ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={recorder.resume}
                className="flex-1 rounded-xl bg-[var(--color-accent)] py-4 text-[15px] font-semibold text-[var(--color-primary)]"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={recorder.stop}
                className="flex-1 rounded-xl bg-[#ef4444] py-4 text-[15px] font-semibold text-white"
              >
                Stop
              </button>
            </div>
          ) : recorder.status === "recorded" ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={recorder.reset}
                className="flex-1 rounded-xl border border-[var(--color-border)] py-4 text-[15px] font-semibold text-[var(--color-text-muted)]"
              >
                Re-record
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="flex-[2] rounded-xl bg-[var(--color-accent)] py-4 text-[15px] font-semibold text-[var(--color-primary)]"
              >
                {areaIndex === currentAreas.length - 1
                  ? `Complete ${currentBlock?.type === "shared" ? "Shared" : "Unit"}`
                  : "Next Area"}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={recorder.start}
                className="flex-[2] rounded-xl bg-[var(--color-accent)] py-4 text-[15px] font-semibold text-[var(--color-primary)]"
              >
                Record
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 rounded-xl border border-[var(--color-border)] py-4 text-[15px] font-semibold text-[var(--color-text-muted)]"
              >
                Skip
              </button>
            </div>
          )}
          <button
            type="button"
            disabled={!canGoBack && !["recording", "paused"].includes(recorder.status)}
            onClick={() => {
              if (["recording", "paused"].includes(recorder.status)) {
                recorder.stop();
                recorder.reset();
              }
              handleBack();
            }}
            className="w-full rounded-xl bg-[var(--color-bg-light)] py-3 text-[15px] font-semibold text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {["recording", "paused"].includes(recorder.status) ? "Cancel recording" : "Back"}
          </button>
        </div>
      </div>
    </div>
  );
}
