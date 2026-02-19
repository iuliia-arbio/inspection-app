import { supabase } from './supabase';
import type { Deal, Apartment, DealWithApartments, FocusArea, UnitConfig } from './types';
import { DEFAULT_UNIT_CONFIG } from './types';

/** Fetch all deals with their apartments. Falls back to mock data only when Supabase URL is not configured (local dev). */
export async function getDealsWithApartments(): Promise<DealWithApartments[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    return MOCK_DEALS;
  }

  const { data: deals, error: dealsError } = await supabase
    .from('ins_deals')
    .select('*')
    .order('deal_sku');

  if (dealsError) {
    console.error('[getDealsWithApartments] Supabase error:', dealsError);
    return [];
  }
  if (!deals?.length) {
    return [];
  }

  const { data: apartments } = await supabase
    .from('ins_apartments')
    .select('*')
    .in('deal_sku', deals.map((d) => d.deal_sku));

  const apartmentsByDealSku = (apartments ?? []).reduce<Record<string, Apartment[]>>((acc, apt) => {
    if (!acc[apt.deal_sku]) acc[apt.deal_sku] = [];
    acc[apt.deal_sku].push(apt as Apartment);
    return acc;
  }, {});

  return deals.map((deal) => {
    const apts = apartmentsByDealSku[deal.deal_sku] ?? [];
    apts.sort((a, b) => (a.apartment_sku ?? '').localeCompare(b.apartment_sku ?? '', undefined, { sensitivity: 'base' }));
    return { ...(deal as Deal), apartments: apts };
  });
}

/** Fetch a single deal by ID with apartments. */
export async function getDealById(dealId: string): Promise<DealWithApartments | null> {
  const deals = await getDealsWithApartments();
  return deals.find((d) => d.id === dealId) ?? null;
}

/** Fetch inspection by ID. */
export async function getInspection(
  inspectionId: string
): Promise<{ selectedUnitIds: string[]; unitConfigs: Record<string, UnitConfig>; includeSharedAreas: boolean; dealId: string | null } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;

  const { data, error } = await supabase
    .from("ins_inspections")
    .select("selected_unit_ids, unit_configs, deal_id")
    .eq("id", inspectionId)
    .single();

  if (error || !data) return null;

  const raw = data.unit_configs as Record<string, unknown> | null;
  const includeSharedAreas = (raw as Record<string, boolean>)?._includeSharedAreas !== false;
  const unitConfigs: Record<string, UnitConfig> = {};
  for (const [id, c] of Object.entries(raw ?? {})) {
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
  return {
    selectedUnitIds: (data.selected_unit_ids as string[]) ?? [],
    unitConfigs,
    includeSharedAreas,
    dealId: (data.deal_id as string) ?? null,
  };
}

/** Create inspection. Returns inspection ID or null if Supabase not configured / error. */
export async function createInspection(
  dealId: string,
  selectedUnitIds: string[],
  unitConfigs: Record<string, UnitConfig>,
  includeSharedAreas = true
): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;

  const configsWithMeta = { _includeSharedAreas: includeSharedAreas, ...unitConfigs };

  const { data, error } = await supabase
    .from('ins_inspections')
    .insert({
      deal_id: dealId,
      status: 'in_progress',
      selected_unit_ids: selectedUnitIds,
      unit_configs: configsWithMeta,
    })
    .select('id')
    .single();

  if (error || !data) return null;
  return data.id;
}

/** Fetch all area recordings for a block (shared or one unit). */
export async function getAreaRecordingsForBlock(
  inspectionId: string,
  scope: "shared" | "unit",
  apartmentId: string | null
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !supabase) return [];
  let query = supabase
    .from("ins_area_recordings")
    .select("id, area_id, area_name, transcript, transcript_status")
    .eq("inspection_id", inspectionId)
    .eq("scope", scope);
  if (scope === "shared") {
    query = query.is("apartment_id", null);
  } else {
    query = query.eq("apartment_id", apartmentId);
  }
  const { data } = await query.order("created_at", { ascending: true });
  return data ?? [];
}

/** Fetch area recording by ID. */
export async function getAreaRecording(areaRecordingId: string) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !supabase) return null;
  const { data, error } = await supabase
    .from("ins_area_recordings")
    .select("id, inspection_id, apartment_id, area_id, area_name, scope, transcript, transcript_status")
    .eq("id", areaRecordingId)
    .single();
  if (error || !data) return null;
  return data;
}

/** Update inspection unit_configs. Preserves _includeSharedAreas from existing config. */
export async function updateInspectionConfig(
  inspectionId: string,
  unitConfigs: Record<string, UnitConfig>
): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || inspectionId.startsWith("demo-")) return false;

  const { data: existing } = await supabase
    .from('ins_inspections')
    .select('unit_configs')
    .eq('id', inspectionId)
    .single();

  const existingMeta = (existing?.unit_configs as Record<string, unknown>) ?? {};
  const includeShared = existingMeta._includeSharedAreas !== false;

  const { error } = await supabase
    .from('ins_inspections')
    .update({ unit_configs: { _includeSharedAreas: includeShared, ...unitConfigs } })
    .eq('id', inspectionId);

  return !error;
}

/** Mark inspection as submitted (completed). */
export async function completeInspection(inspectionId: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || inspectionId.startsWith("demo-")) return false;

  const { error } = await supabase
    .from('ins_inspections')
    .update({
      status: 'submitted',
      completed_at: new Date().toISOString(),
    })
    .eq('id', inspectionId);

  return !error;
}

const MOCK_DEALS: DealWithApartments[] = [
  {
    id: 'deal_1',
    deal_sku: 'DE_BER_014_Apartmently_019',
    notion_page_id: 'mock_1',
    focus_areas: [
      { category: 'check-in', issues: ['Access Complication (Digital Keys/App)', 'Unclear Check-in/Check-out Instructions'] },
      { category: 'cleanliness', issues: ['General Cleanliness (Dust, Dirt, Stains, mold)', 'Poor Building Condition'] },
      { category: 'accuracy', issues: ['Room/Amenities Not As Pictured/Described'] },
    ] as FocusArea[],
    synced_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    apartments: [
      { id: 'apt_101', deal_sku: 'DE_BER_014_Apartmently_019', notion_page_id: 'mock_a101', apartment_sku: 'A101', issues: ['Old dust bunnies on floor in stairwell and entrance (1 mentions, 12.5%)', 'Marks on the walls (1 mentions, 12.5%)'], booking_com_url: 'https://www.booking.com/example/apt101', airbnb_url: 'https://www.airbnb.com/rooms/example101', synced_at: '', created_at: '' },
      { id: 'apt_102', deal_sku: 'DE_BER_014_Apartmently_019', notion_page_id: 'mock_a102', apartment_sku: 'A102', issues: ['Long hairs from previous guests in shower (1 mentions, 12.5%)', 'Some furniture slightly damaged (1 mentions, 12.5%)'], booking_com_url: null, airbnb_url: 'https://www.airbnb.com/rooms/example102', synced_at: '', created_at: '' },
      { id: 'apt_103', deal_sku: 'DE_BER_014_Apartmently_019', notion_page_id: 'mock_a103', apartment_sku: 'A103', issues: ['Leaky window in room (left side)', 'Mold in bathroom grout', 'Wi-Fi not working (2 mentions, 25%)'], booking_com_url: 'https://www.booking.com/example/apt103', airbnb_url: null, synced_at: '', created_at: '' },
      { id: 'apt_104', deal_sku: 'DE_BER_014_Apartmently_019', notion_page_id: 'mock_a104', apartment_sku: 'A104', issues: [], synced_at: '', created_at: '' },
      { id: 'apt_105', deal_sku: 'DE_BER_014_Apartmently_019', notion_page_id: 'mock_a105', apartment_sku: 'A105', issues: ['Stove not heating properly', 'Dirty towels (1 mentions, 12.5%)'], booking_com_url: 'https://www.booking.com/example/apt105', airbnb_url: 'https://www.airbnb.com/rooms/example105', synced_at: '', created_at: '' },
    ],
  },
  {
    id: 'deal_2',
    deal_sku: 'DE_BER_015_Apartmently_020',
    notion_page_id: 'mock_2',
    focus_areas: [{ category: 'cleanliness', issues: ['General Cleanliness'] }],
    synced_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    apartments: [
      { id: 'apt_201', deal_sku: 'DE_BER_015_Apartmently_020', notion_page_id: 'mock_b201', apartment_sku: 'B201', issues: [], synced_at: '', created_at: '' },
      { id: 'apt_202', deal_sku: 'DE_BER_015_Apartmently_020', notion_page_id: 'mock_b202', apartment_sku: 'B202', issues: ['Broken door handle (1 mentions, 12.5%)'], synced_at: '', created_at: '' },
    ],
  },
];
