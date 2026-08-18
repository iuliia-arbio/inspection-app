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


/**
 * Key identifying one inspected area within an inspection.
 *
 * Unit-qualified on purpose: area ids repeat across units (every unit has a
 * `bathroom_1`), so keying on the area id alone conflated different units'
 * screens — which is also how one unit's audio file came to overwrite another's
 * in storage.
 */
export function areaKey(apartmentId: string | null | undefined, areaId: string): string {
  return `${apartmentId ?? "shared"}::${areaId}`;
}

export type SavedAreaRow = {
  area_id: string;
  apartment_id: string | null;
  scope: string;
};

export type ResumePosition =
  /** Nothing saved yet — start at the top. */
  | { kind: "fresh" }
  /** First area with nothing stored for it. */
  | { kind: "area"; blockIndex: number; areaIndex: number }
  /** Every area is stored; pick up on the last block's follow-up screen. */
  | { kind: "followup"; blockIndex: number; areaIndex: number };

/**
 * Where an interrupted inspection should pick up, derived from the areas the
 * server already holds.
 *
 * Deriving the position from stored data rather than from a saved cursor is the
 * point: a cursor can outlive the upload it refers to (or die with the tab),
 * while these rows ARE the saved work, so "where you are" and "what is saved"
 * cannot drift apart. Freestyle notes are ignored — they belong to no area.
 */
export function resolveResumePosition(
  blocks: InspectionBlock[],
  savedAreas: SavedAreaRow[]
): ResumePosition {
  const saved = new Set(
    savedAreas
      .filter((r) => r.scope !== "freestyle")
      .map((r) => areaKey(r.apartment_id, r.area_id))
  );
  if (saved.size === 0 || blocks.length === 0) return { kind: "fresh" };

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    for (let areaIndex = 0; areaIndex < block.areas.length; areaIndex++) {
      if (saved.has(areaKey(block.unitId, block.areas[areaIndex].id))) continue;
      return { kind: "area", blockIndex, areaIndex };
    }
  }

  const blockIndex = blocks.length - 1;
  return {
    kind: "followup",
    blockIndex,
    areaIndex: Math.max(0, blocks[blockIndex].areas.length - 1),
  };
}
