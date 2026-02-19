import { NextResponse } from "next/server";
import { generateDeepDiveQuestions } from "@/lib/generateDeepDives";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.type === "unit") {
      const { areaId, issues } = body;
      if (!areaId || !Array.isArray(issues)) {
        return NextResponse.json({ error: "Missing areaId or issues" }, { status: 400 });
      }
      const questions = await generateDeepDiveQuestions({ type: "unit", areaId, issues });
      return NextResponse.json({ questions });
    }

    if (body.type === "shared") {
      const { areaId, focusAreas } = body;
      if (!areaId || !Array.isArray(focusAreas)) {
        return NextResponse.json({ error: "Missing areaId or focusAreas" }, { status: 400 });
      }
      const questions = await generateDeepDiveQuestions({ type: "shared", areaId, focusAreas });
      return NextResponse.json({ questions });
    }

    return NextResponse.json({ error: "Invalid type: use unit or shared" }, { status: 400 });
  } catch (e) {
    console.error("generate-deep-dives failed:", e);
    return NextResponse.json({ error: "Failed to generate questions" }, { status: 500 });
  }
}
