// Database row types (match Supabase schema)
export interface Deal {
  id: string;
  deal_sku: string;  // Deal identifier and display name
  notion_page_id: string;
  focus_areas: FocusArea[];
  synced_at: string;
  created_at: string;
}

export interface FocusArea {
  category: string;
  issues: string[];
}

export interface Apartment {
  id: string;
  deal_sku: string;  // Links to ins_deals.deal_sku
  notion_page_id: string;
  apartment_sku: string;  // e.g. "A101", "A102"
  issues: string[];
  booking_com_url?: string | null;  // Listing link from n8n
  airbnb_url?: string | null;       // Listing link from n8n
  hostaway_listing_id?: string | null;  // Hostaway listing identifier from n8n
  synced_at: string;
  created_at: string;
}

export interface UnitConfig {
  bedrooms: number;
  bathrooms: number;
  living_rooms: number;
  kitchen: number;
  balcony: number;
}

export const DEFAULT_UNIT_CONFIG: UnitConfig = {
  bedrooms: 1,
  bathrooms: 1,
  living_rooms: 0,
  kitchen: 1,
  balcony: 0,
};

export interface Inspection {
  id: string;
  deal_id: string;
  inspector_name: string | null;
  status: 'in_progress' | 'completed' | 'submitted';
  unit_configs: Record<string, UnitConfig>;
  selected_unit_ids: string[];
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

// UI / flow types
export interface Area {
  id: string;
  name: string;
  scope: 'shared' | 'unit';
  canMultiply?: boolean;
}

export interface InspectionBlock {
  type: 'shared' | 'unit';
  unitId: string | null;
  unitName: string;
  areas: Area[];
  issues: string[];
}

export interface DealWithApartments extends Deal {
  apartments: Apartment[];
}
