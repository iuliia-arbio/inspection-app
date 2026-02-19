import { NextResponse } from "next/server";
import { generateReportForInspection } from "@/lib/generateReport";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inspectionId } = await params;
  if (!inspectionId || inspectionId.startsWith("demo-")) {
    return NextResponse.json({ error: "Invalid inspection" }, { status: 400 });
  }

  const result = await generateReportForInspection(inspectionId);

  if (!result.ok) {
    const status = result.error === "Inspection not found" ? 404 : 503;
    return NextResponse.json(
      { error: result.error ?? "Report generation failed" },
      { status }
    );
  }

  return NextResponse.json({ ok: true });
}
