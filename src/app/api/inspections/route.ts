import { NextResponse } from "next/server";
import { createInspection } from "@/lib/data";

export async function POST(request: Request) {
  try {
    const { dealId, selectedUnitIds, unitConfigs, includeSharedAreas } = await request.json();

    if (!dealId || !Array.isArray(selectedUnitIds)) {
      return NextResponse.json(
        { error: "Missing dealId or selectedUnitIds" },
        { status: 400 }
      );
    }

    const inspectionId = await createInspection(
      dealId,
      selectedUnitIds,
      unitConfigs ?? {},
      includeSharedAreas !== false
    );

    // When Supabase not configured, return null - client will use demo mode
    return NextResponse.json({ inspectionId });
  } catch (err) {
    console.error("Failed to create inspection:", err);
    return NextResponse.json(
      { error: "Failed to create inspection" },
      { status: 500 }
    );
  }
}
