import { NextResponse } from "next/server";
import { getInspection, updateInspectionConfig, completeInspection } from "@/lib/data";
import { generateReportForInspection } from "@/lib/generateReport";

// Report generation runs multiple AI calls; allow up to 60s (Vercel Pro default max)
export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const data = await getInspection(id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const body = await request.json().catch(() => ({}));

  if (body?.complete === true || body?.status === "submitted") {
    const ok = await completeInspection(id);
    if (!ok) return NextResponse.json({ error: "Update failed" }, { status: 500 });

    let reportResult: { ok: boolean; error?: string } | null = null;
    if (process.env.NOTION_API_KEY && process.env.NOTION_INSPECTION_DATABASE_ID) {
      console.log(`[Report] Starting report generation for inspection ${id}`);
      reportResult = await generateReportForInspection(id);
      if (reportResult.ok) console.log(`[Report] Report generated for ${id}`);
      else console.error(`[Report] Report failed for ${id}:`, reportResult.error);
    } else {
      console.warn(
        "[Report] Skipped: NOTION_API_KEY or NOTION_INSPECTION_DATABASE_ID not set"
      );
    }
    return NextResponse.json({
      ok: true,
      reportGenerated: reportResult?.ok ?? false,
      reportError: reportResult?.ok === false ? reportResult.error : undefined,
    });
  }

  const unitConfigs = body?.unitConfigs;
  if (!unitConfigs || typeof unitConfigs !== "object") {
    return NextResponse.json({ error: "Missing unitConfigs" }, { status: 400 });
  }
  const ok = await updateInspectionConfig(id, unitConfigs);
  if (!ok) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
