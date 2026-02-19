import { supabase } from "./supabase";
import { getDealById } from "./data";
import { buildBlocks } from "./inspection";
import type { DealWithApartments, UnitConfig } from "./types";
import { DEFAULT_UNIT_CONFIG } from "./types";
import { BASE_QUESTIONS, getQuestionLabel } from "./questions";

export interface ReportAreaRecording {
  id: string;
  area_id: string;
  area_name: string;
  transcript: string | null;
  scope: string;
  apartment_id: string | null;
}

export interface ReportQuestionScore {
  question_id: string;
  score: number | null;
  details: string | null;
  follow_up_answer: string | null;
}

export interface ReportPhoto {
  id: string;
  storage_path: string;
  question_id: string | null;
}

export interface ReportBlockData {
  blockName: string;
  scope: "shared" | "unit";
  unitId: string | null;
  recordings: Array<{
    recording: ReportAreaRecording;
    scores: ReportQuestionScore[];
    photos: ReportPhoto[];
  }>;
  issues: string[];
}

export interface ReportData {
  inspectionId: string;
  deal: DealWithApartments;
  completedAt: string | null;
  blocks: ReportBlockData[];
  freestyleTranscripts: string[];
  focusAreas: { category: string; issues: string[] }[];
}

/** Get quarter string (e.g. Q2/2026) from ISO date string. */
export function getQuarterFromDate(isoDate: string | null): string {
  if (!isoDate) {
    const now = new Date();
    return `Q${Math.ceil((now.getMonth() + 1) / 3)}/${now.getFullYear()}`;
  }
  const d = new Date(isoDate);
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `Q${q}/${d.getFullYear()}`;
}

/** Collect all question IDs from BASE_QUESTIONS for Notion schema. */
export const ALL_QUESTION_IDS = (() => {
  const ids = new Set<string>();
  for (const arr of Object.values(BASE_QUESTIONS)) {
    for (const q of arr) ids.add(q.id);
  }
  return Array.from(ids);
})();

/** Fetch full inspection data for report generation. */
export async function getFullInspectionForReport(
  inspectionId: string
): Promise<ReportData | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !supabase) return null;

  const { data: inspRow, error: inspError } = await supabase
    .from("ins_inspections")
    .select("deal_id, completed_at, unit_configs, selected_unit_ids")
    .eq("id", inspectionId)
    .single();

  if (inspError || !inspRow) return null;

  const dealId = inspRow.deal_id as string;
  const deal = await getDealById(dealId);
  if (!deal) return null;

  const rawConfigs = (inspRow.unit_configs ?? {}) as Record<string, unknown>;
  const includeSharedAreas = (rawConfigs._includeSharedAreas as boolean) !== false;
  const unitConfigs: Record<string, UnitConfig> = {};
  for (const [id, c] of Object.entries(rawConfigs)) {
    if (id.startsWith("_")) continue;
    const conf = c as Partial<UnitConfig> | null;
    unitConfigs[id] = {
      ...DEFAULT_UNIT_CONFIG,
      bedrooms: conf?.bedrooms ?? DEFAULT_UNIT_CONFIG.bedrooms,
      bathrooms: conf?.bathrooms ?? DEFAULT_UNIT_CONFIG.bathrooms,
      living_rooms: conf?.living_rooms ?? DEFAULT_UNIT_CONFIG.living_rooms,
      kitchen: conf?.kitchen ?? DEFAULT_UNIT_CONFIG.kitchen,
      balcony: conf?.balcony ?? DEFAULT_UNIT_CONFIG.balcony,
    };
  }
  const selectedUnitIds = (inspRow.selected_unit_ids as string[]) ?? [];
  const completedAt = inspRow.completed_at as string | null;

  const blocks = buildBlocks(deal, selectedUnitIds, unitConfigs, includeSharedAreas);

  const blockData: ReportBlockData[] = [];

  for (const block of blocks) {
    const recordings = await getAreaRecordingsForBlock(
      inspectionId,
      block.type as "shared" | "unit",
      block.unitId
    );

    const recordData: ReportBlockData["recordings"] = [];

    for (const rec of recordings) {
      const [scores, photos] = await Promise.all([
        getScoresForRecording(rec.id),
        getPhotosForRecording(rec.id),
      ]);
      recordData.push({
        recording: rec as ReportAreaRecording,
        scores,
        photos,
      });
    }

    blockData.push({
      blockName: block.unitName,
      scope: block.type as "shared" | "unit",
      unitId: block.unitId,
      recordings: recordData,
      issues: block.issues ?? [],
    });
  }

  const freestyleTranscripts = await getFreestyleTranscripts(inspectionId);

  return {
    inspectionId,
    deal,
    completedAt,
    blocks: blockData,
    freestyleTranscripts,
    focusAreas: deal.focus_areas ?? [],
  };
}

async function getAreaRecordingsForBlock(
  inspectionId: string,
  scope: "shared" | "unit",
  apartmentId: string | null
): Promise<ReportAreaRecording[]> {
  let query = supabase
    .from("ins_area_recordings")
    .select("id, area_id, area_name, transcript, scope, apartment_id")
    .eq("inspection_id", inspectionId)
    .eq("scope", scope)
    .not("area_id", "like", "freestyle_%");

  if (scope === "shared") {
    query = query.is("apartment_id", null);
  } else {
    query = query.eq("apartment_id", apartmentId);
  }

  const { data } = await query.order("created_at", { ascending: true });
  return (data ?? []) as ReportAreaRecording[];
}

async function getScoresForRecording(
  areaRecordingId: string
): Promise<ReportQuestionScore[]> {
  const { data } = await supabase
    .from("ins_question_scores")
    .select("question_id, score, details, follow_up_answer")
    .eq("area_recording_id", areaRecordingId);
  return (data ?? []) as ReportQuestionScore[];
}

async function getPhotosForRecording(
  areaRecordingId: string
): Promise<ReportPhoto[]> {
  const { data } = await supabase
    .from("ins_inspection_photos")
    .select("id, storage_path, question_id")
    .eq("area_recording_id", areaRecordingId);
  return (data ?? []) as ReportPhoto[];
}

async function getFreestyleTranscripts(inspectionId: string): Promise<string[]> {
  const { data } = await supabase
    .from("ins_area_recordings")
    .select("transcript")
    .eq("inspection_id", inspectionId)
    .eq("scope", "freestyle");
  const transcripts: string[] = [];
  for (const row of data ?? []) {
    const t = (row as { transcript: string | null }).transcript;
    if (t?.trim()) transcripts.push(t.trim());
  }
  return transcripts;
}

/** Build a flat map of question_id -> score for a block. */
export function buildBlockScoresMap(
  block: ReportBlockData
): Record<string, number | null> {
  const map: Record<string, number | null> = {};
  for (const { scores } of block.recordings) {
    for (const s of scores) {
      map[s.question_id] = s.score;
    }
  }
  return map;
}

/** Get full question text by id. */
export function getQuestionText(questionId: string): string {
  for (const arr of Object.values(BASE_QUESTIONS)) {
    const q = arr.find((x) => x.id === questionId);
    if (q) return q.question;
  }
  return questionId;
}

/** Re-export for Notion/report display. */
export { getQuestionLabel };
