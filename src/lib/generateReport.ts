/**
 * Generates and pushes the inspection report to Notion.
 * Called when an inspection is submitted.
 */
import OpenAI from "openai";
import { getFullInspectionForReport, buildBlockScoresMap, getQuarterFromDate, getQuestionLabel, ALL_QUESTION_IDS } from "./reportData";
import { buildSummaryPrompt, buildIssuesPromptForBlock } from "./reportPrompts";
import {
  appendBlocksToPage,
  appendBlocksToBlock,
  createPageInDatabase,
  getDatabaseUrl,
  heading2,
  heading2Toggle,
  paragraph,
  bookmark,
  heading3,
  image,
} from "./notionClient";
import { supabase } from "./supabase";
import { STORAGE_BUCKETS } from "./constants";
import type { ReportData, ReportBlockData } from "./reportData";

const PHOTO_URL_EXPIRY_SEC = 7 * 24 * 60 * 60; // 7 days

export async function generateReportForInspection(
  inspectionId: string
): Promise<{ ok: boolean; error?: string }> {
  const notionKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_INSPECTION_DATABASE_ID;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!notionKey || !databaseId) {
    console.error("[Report] Notion not configured (missing API key or database ID)");
    return { ok: false, error: "Notion not configured" };
  }
  if (!openaiKey) {
    console.error("[Report] OpenAI not configured");
    return { ok: false, error: "OpenAI not configured" };
  }

  const data = await getFullInspectionForReport(inspectionId);
  if (!data) {
    console.error("[Report] Could not load inspection data for", inspectionId);
    return { ok: false, error: "Inspection not found" };
  }

  const completedAt = data.completedAt ?? new Date().toISOString();
  const dateStr = formatDate(completedAt);
  const quarter = getQuarterFromDate(completedAt);
  const dealPageId = data.deal.notion_page_id;

  if (!dealPageId || dealPageId.startsWith("mock_")) {
    console.error(
      "[Report] Deal has no valid Notion page. notion_page_id:",
      dealPageId || "(missing)"
    );
    return { ok: false, error: "Deal has no valid Notion page" };
  }

  try {
    // Run all AI calls in parallel to fit within Vercel Hobby 10s limit
    const [summary, ...blockIssues] = await Promise.all([
      generateSummary(data),
      ...data.blocks.map((block) => generateIssuesForBlock(block)),
    ]);

    const toggleBlock = heading2Toggle(`Inspection ${dateStr}`);
    const appendRes = await appendBlocksToPage(dealPageId, [toggleBlock]);
    const toggleBlockId = appendRes.results?.[0]?.id;
    if (!toggleBlockId) {
      return { ok: false, error: "Failed to get toggle block id" };
    }

    const dbUrl = getDatabaseUrl(databaseId);
    await appendBlocksToBlock(toggleBlockId, [
      paragraph(summary),
      paragraph("\u2014"),
      paragraph("View full inspection details:"),
      paragraph("Apply filters on Deal and Quarter to find this inspection."),
      bookmark(dbUrl, "Open Inspection Database"),
    ]);

    for (let i = 0; i < data.blocks.length; i++) {
      await addBlockRowToDatabase(data, data.blocks[i], quarter, databaseId, blockIssues[i]);
    }

    return { ok: true };
  } catch (err) {
    console.error("Report generation failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Report generation failed",
    };
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

async function generateSummary(data: ReportData): Promise<string> {
  const prompt = buildSummaryPrompt(data);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You write concise property inspection summaries. Output plain text only, no markdown." },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
  });
  const text = completion.choices[0]?.message?.content?.trim() ?? "";
  return text || "No summary generated.";
}

async function generateIssuesForBlock(block: ReportBlockData): Promise<{
  cleanliness_issues: string[];
  maintenance_issues: string[];
  checkin_issues: string[];
  accuracy_issues: string[];
}> {
  const prompt = buildIssuesPromptForBlock(block);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You categorize property inspection issues. Respond only with valid JSON, no markdown." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  });
  const text = completion.choices[0]?.message?.content?.trim() ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : "{}";
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      cleanliness_issues: Array.isArray(parsed.cleanliness_issues) ? parsed.cleanliness_issues : [],
      maintenance_issues: Array.isArray(parsed.maintenance_issues) ? parsed.maintenance_issues : [],
      checkin_issues: Array.isArray(parsed.checkin_issues) ? parsed.checkin_issues : [],
      accuracy_issues: Array.isArray(parsed.accuracy_issues) ? parsed.accuracy_issues : [],
    };
  } catch {
    return {
      cleanliness_issues: [],
      maintenance_issues: [],
      checkin_issues: [],
      accuracy_issues: [],
    };
  }
}

function formatIssuesList(issues: string[]): string {
  if (issues.length === 0) return "";
  return issues.map((i) => `• ${i}`).join("\n");
}

type BlockIssues = {
  cleanliness_issues: string[];
  maintenance_issues: string[];
  checkin_issues: string[];
  accuracy_issues: string[];
};

async function addBlockRowToDatabase(
  data: ReportData,
  block: ReportBlockData,
  quarter: string,
  databaseId: string,
  issues: BlockIssues
): Promise<void> {
  const scoresMap = buildBlockScoresMap(block);

  const properties: Record<string, unknown> = {
    Name: { title: [{ type: "text", text: { content: block.blockName } }] },
    Quarter: { select: { name: quarter } },
    Deal: { rich_text: [{ type: "text", text: { content: data.deal.deal_sku } }] },
    "Cleanliness issues": { rich_text: [{ type: "text", text: { content: formatIssuesList(issues.cleanliness_issues).slice(0, 2000) } }] },
    "Maintenance issues": { rich_text: [{ type: "text", text: { content: formatIssuesList(issues.maintenance_issues).slice(0, 2000) } }] },
    "Check-in issues": { rich_text: [{ type: "text", text: { content: formatIssuesList(issues.checkin_issues).slice(0, 2000) } }] },
    "Accuracy issues": { rich_text: [{ type: "text", text: { content: formatIssuesList(issues.accuracy_issues).slice(0, 2000) } }] },
  };

  for (const qId of ALL_QUESTION_IDS) {
    const score = scoresMap[qId];
    if (score != null) {
      properties[getQuestionLabel(qId)] = { number: score };
    }
  }

  const pageId = await createPageInDatabase(databaseId, properties);

  const pageBlocks: Array<ReturnType<typeof heading2> | ReturnType<typeof heading3> | ReturnType<typeof paragraph> | ReturnType<typeof image>> = [];
  for (const { recording, scores, photos } of block.recordings) {
    pageBlocks.push(heading2(recording.area_name));
    for (const s of scores) {
      const qLabel = getQuestionLabel(s.question_id);
      const scoreStr = s.score != null ? `${s.score}/10` : "—";
      pageBlocks.push(heading3(`${qLabel} — ${scoreStr}`));
      if (s.details?.trim()) {
        pageBlocks.push(paragraph(s.details));
      }
      if (s.follow_up_answer?.trim()) {
        pageBlocks.push(paragraph(`Follow-up answer: ${s.follow_up_answer}`));
      }
      const relevantPhotos = photos.filter((p) => p.question_id === s.question_id);
      const photoUrls = await getPhotoUrls(relevantPhotos);
      for (const url of photoUrls) {
        pageBlocks.push(image(url));
      }
    }
    const areaPhotos = photos.filter((p) => p.question_id === null);
    if (areaPhotos.length > 0) {
      pageBlocks.push(heading3(`${recording.area_name} — Photos`));
      const areaUrls = await getPhotoUrls(areaPhotos);
      for (const url of areaUrls) {
        pageBlocks.push(image(url));
      }
    }
  }

  if (pageBlocks.length > 0) {
    await appendBlocksToPage(pageId, pageBlocks);
  }
}

async function getPhotoUrls(
  photos: { storage_path: string }[]
): Promise<string[]> {
  if (!supabase || photos.length === 0) return [];
  const urls: string[] = [];
  for (const p of photos) {
    const { data } = await supabase.storage
      .from(STORAGE_BUCKETS.PHOTOS)
      .createSignedUrl(p.storage_path, PHOTO_URL_EXPIRY_SEC);
    if (data?.signedUrl) urls.push(data.signedUrl);
  }
  return urls;
}
