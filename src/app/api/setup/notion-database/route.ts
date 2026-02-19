/**
 * One-time setup: creates the inspection database in Notion.
 * Requires NOTION_API_KEY and NOTION_PARENT_PAGE_ID (page where DB will be created).
 * Returns the database_id to add to NOTION_INSPECTION_DATABASE_ID in .env.local
 */
import { NextResponse } from "next/server";
import { ALL_QUESTION_IDS } from "@/lib/reportData";
import { getQuestionLabel } from "@/lib/questions";

function getHeaders(): Record<string, string> {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error("NOTION_API_KEY not configured");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };
}

async function runSetup() {
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!parentPageId) {
    return NextResponse.json(
      { error: "NOTION_PARENT_PAGE_ID not configured. Create a page (e.g. 'Inspections') in Notion, share it with your integration, and add its ID to env." },
      { status: 400 }
    );
  }

  const quarterOptions = [];
  for (let y = 2024; y <= 2028; y++) {
    for (let q = 1; q <= 4; q++) {
      quarterOptions.push({ name: `Q${q}/${y}`, color: "default" as const });
    }
  }

  const properties: Record<string, unknown> = {
    Name: { title: {} },
    Quarter: { select: { options: quarterOptions } },
    Deal: { rich_text: {} },
    "Cleanliness issues": { rich_text: {} },
    "Maintenance issues": { rich_text: {} },
    "Check-in issues": { rich_text: {} },
    "Accuracy issues": { rich_text: {} },
  };

  for (const qId of ALL_QUESTION_IDS) {
    properties[getQuestionLabel(qId)] = { number: {} };
  }

  try {
    const res = await fetch("https://api.notion.com/v1/databases", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        parent: { type: "page_id", page_id: parentPageId },
        title: [{ type: "text", text: { content: "Inspections" } }],
        properties,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        { error: `Notion API error: ${res.status}`, details: err },
        { status: 500 }
      );
    }

    const data = (await res.json()) as { id: string };
    return NextResponse.json({
      ok: true,
      database_id: data.id,
      message: `Add to .env.local: NOTION_INSPECTION_DATABASE_ID=${data.id}`,
    });
  } catch (err) {
    console.error("Setup failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Setup failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return runSetup();
}

export async function POST() {
  return runSetup();
}
