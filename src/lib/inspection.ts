import { SHARED_AREAS, UNIT_AREAS_TEMPLATE } from "./questions";
import type { DealWithApartments, InspectionBlock, UnitConfig } from "./types";
import { DEFAULT_UNIT_CONFIG } from "./types";

export function buildBlocks(
  deal: DealWithApartments,
  selectedUnitIds: string[],
  unitConfigs: Record<string, UnitConfig>,
  includeSharedAreas = true
): InspectionBlock[] {
  if (!includeSharedAreas && !selectedUnitIds.length) return [];

  const blocks: InspectionBlock[] = includeSharedAreas
    ? [
        {
          type: "shared",
          unitId: null,
          unitName: "Shared Areas",
          areas: SHARED_AREAS,
          issues: [],
        },
      ]
    : [];

  for (const unitId of selectedUnitIds) {
    const apt = deal.apartments.find((a) => a.id === unitId);
    if (!apt) continue;
    const config = unitConfigs[unitId] ?? DEFAULT_UNIT_CONFIG;
    const areas: InspectionBlock["areas"] = [];

    for (const t of UNIT_AREAS_TEMPLATE) {
      if (t.id === "living") {
        if (config.living_rooms < 1) continue;
        for (let i = 1; i <= config.living_rooms; i++) {
          areas.push({
            ...t,
            id: config.living_rooms > 1 ? `living_${i}` : "living",
            name: config.living_rooms > 1 ? `Living Room ${i}` : "Living Room",
          });
        }
      } else if (t.id === "kitchen") {
        if ((config.kitchen ?? 1) < 1) continue;
        areas.push({ ...t });
      } else if (t.id === "bedroom") {
        for (let i = 1; i <= config.bedrooms; i++) {
          areas.push({
            ...t,
            id: `bedroom_${i}`,
            name: config.bedrooms > 1 ? `Bedroom ${i}` : "Bedroom",
          });
        }
      } else if (t.id === "bathroom") {
        for (let i = 1; i <= config.bathrooms; i++) {
          areas.push({
            ...t,
            id: `bathroom_${i}`,
            name: config.bathrooms > 1 ? `Bathroom ${i}` : "Bathroom",
          });
        }
      } else if (t.id === "balcony") {
        if ((config.balcony ?? 0) < 1) continue;
        areas.push({ ...t });
      } else {
        areas.push({ ...t });
      }
    }

    blocks.push({
      type: "unit",
      unitId,
      unitName: `Unit ${apt.apartment_sku}`,
      areas,
      issues: apt.issues ?? [],
    });
  }

  return blocks;
}

export function getBaseAreaId(areaId: string): string {
  return areaId.replace(/_\d+$/, "");
}

