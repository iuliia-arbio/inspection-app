// Section-voice prompts: the open, human questions an inspector answers by
// voice, each MAPPED to a subset of that section's structured fields. The AI
// extraction for a clip is scoped to the prompt's `target_slugs`.
//
// Authoring rules:
//   - Group fields by how an inspector naturally SPEAKS, not by data structure.
//   - Each field maps to exactly one prompt within its section (no overlap).
//   - A repeater group = its own prompt (one item per object/issue mentioned).
//   - Voice-unfriendly fields (exact codes/serials, precise measurements, media)
//     are intentionally NOT listed — they stay manual taps.
//
// Keyed by phase_id (see PHASES in lib/firstVisit/questions.ts). Sections with
// no entry simply have no voice prompts. A guard test
// (section-voice-prompts.test.ts) fails CI if any target_slug drifts from the
// config (missing, wrong phase, media, or mapped twice).
//
// EXCLUDED phases (tapping wins, no entry): '1' visit metadata, '14' photos &
// videos. Manual carve-outs inside voiced sections (NOT listed): the smart-lock
// serial + default access code in check-in (#4), door-width + ceiling-height
// measurements (#8/#13).

export type SectionPrompt = {
  /** Stable id, unique within the phase. */
  id: string;
  /** The open question shown/spoken to the inspector. */
  label: string;
  /** Field slugs this prompt's clip is allowed to fill. */
  target_slugs: string[];
  /** When true, the clip fills ONLY the qualitative summary — the structured
   *  target fields are left for manual entry (still rendered + still used to
   *  anchor the prompt). Off (undefined) everywhere for now; flip per-section
   *  later (e.g. check-in) without any other code change. */
  qualitative_only?: boolean;
};

export const SECTION_VOICE_PROMPTS: Record<string, SectionPrompt[]> = {
  // 2 · Location & neighbourhood
  '2': [
    {
      id: 'p2_location',
      label:
        'Describe the location for guests — overall quality, any safety concerns, the neighbourhood vibe, and who it suits best.',
      target_slugs: [
        'fv_location_quality',
        'fv_location_safety_concern',
        'fv_neighbourhood_narrative',
        'fv_neighbourhood_vibe_tags',
        'fv_best_for_guest_type',
        'fv_location_notes',
      ],
    },
  ],

  // 3 · Building exterior & parking
  '3': [
    {
      id: 'p3_parking',
      label:
        'Walk me through parking — is there any, what type, how many dedicated spots, the spot number, how to access it, bikes, and nearby options.',
      target_slugs: [
        'fv_parking_actual_type',
        'fv_parking_dedicated_spots',
        'fv_parking_spot_number',
        'fv_parking_access_instructions',
        'fv_parking_bike_available',
        'fv_parking_nearby_options',
      ],
    },
    {
      id: 'p3_building_condition',
      label:
        'How is the building itself — overall state, any mold, hallway cleanliness, construction nearby, and which building amenities it has.',
      target_slugs: [
        'fv_building_state',
        'fv_building_mold',
        'fv_building_hallways_clean',
        'fv_building_construction_nearby',
        'fv_building_amenities_verify',
      ],
    },
    {
      id: 'p3_access_elevator',
      label:
        'Accessibility and the elevator — step-free entry, ramps or aids, and if there is a lift: is it working, its size, and its condition.',
      target_slugs: [
        'fv_accessibility_step_free_entry',
        'fv_accessibility_ramps',
        'fv_accessibility_notes',
        'fv_building_elevator_present',
        'fv_building_elevator_working',
        'fv_building_elevator_size',
        'fv_building_elevator_condition',
      ],
    },
    // (No voice prompt for fv_common_area — a single multi-select chip picker is
    // faster to tap than to dictate.)
  ],

  // 4 · Building access & check-in
  '4': [
    {
      id: 'p4_checkin_step',
      label:
        'Walk through check-in. Go step by step — for each step: its name, the access point, the lock type and provider, the lock brand, whether it is primary or backup, and how keys are stored. Then overall: how complex is check-in, and any notes on the whole process.',
      target_slugs: [
        'fv_step_name',
        'fv_step_access_point',
        'fv_step_lock_type',
        'fv_step_smart_lock_provider',
        'fv_step_lock_brand',
        'fv_step_lock_classification',
        'fv_step_key_storage_method',
        'fv_step_storage_brand',
        'fv_checkin_complexity',
        'fv_checkin_notes_overall',
      ],
    },
  ],

  // 5 · Building infrastructure & services
  '5': [
    {
      id: 'p5_storage',
      label:
        'Is there luggage storage on-site? If so, where is it, how do guests access it, and any comments.',
      target_slugs: [
        'fv_storage_onsite_check',
        'fv_storage_location',
        'fv_storage_access_instructions',
        'fv_storage_comments',
      ],
    },
    {
      id: 'p5_trash',
      label:
        'Trash — is there a designated area, where is the container, who handles it, the pickup schedule, and how guests dispose of their trash.',
      target_slugs: [
        'fv_trash_area_present',
        'fv_trash_container_location',
        'fv_trash_handler',
        'fv_trash_pickup_schedule',
        'fv_trash_guest_instructions',
      ],
    },
    {
      id: 'p5_fusebox',
      label:
        'Is there a central building fuse box? If so, where is it, who can access it, and how is it reset.',
      target_slugs: [
        'fv_fusebox_present',
        'fv_fusebox_location',
        'fv_fusebox_access',
        'fv_fusebox_reset_instructions',
      ],
    },
    {
      id: 'p5_fire_safety',
      label:
        'Building fire safety — is there any, a secondary fire exit, the exit route, and any concerns you observed.',
      target_slugs: [
        'fv_fire_safety_present',
        'fv_fire_exit_secondary',
        'fv_fire_exit_route_notes',
        'fv_fire_safety_concerns',
      ],
    },
  ],

  // 6 · Cleaning & laundry
  '6': [
    {
      id: 'p6_cleaning_laundry',
      label:
        'Describe the cleaning and laundry setup — how each is handled, delivery frequency, the nearest laundromat for guests, and any extra services offered.',
      target_slugs: [
        'fv_cleaning_setup',
        'fv_laundry_setup',
        'fv_laundry_delivery_frequency',
        'fv_laundry_nearest_laundromat',
        'fv_extra_services_offered',
      ],
    },
  ],

  // 7 · WiFi
  '7': [
    {
      id: 'p7_wifi',
      label:
        'Tell me about the WiFi — is it available, the network name and password, download and upload speeds, where the router is, and whether guests can reach it.',
      target_slugs: [
        'fv_wifi_present',
        'fv_wifi_ssid',
        'fv_wifi_password',
        'fv_wifi_download_speed_mbps',
        'fv_wifi_upload_speed_mbps',
        'fv_wifi_router_location',
        'fv_wifi_guest_router_access',
      ],
    },
  ],

  // 8 · Unit identity
  '8': [
    {
      id: 'p8_identity',
      label:
        'Identify the unit — its floor, number or location, the unit type, and whether it has a balcony and how many.',
      target_slugs: [
        'fv_unit_floor_number',
        'fv_unit_location_in_building',
        'fv_unit_type_check',
        'fv_unit_balcony_present',
        'fv_unit_balconies_count',
      ],
    },
    {
      id: 'p8_view_noise',
      label:
        'What is the view and any comments on it, and is there noise with the windows closed — and from what source?',
      target_slugs: [
        'fv_view_actual',
        'fv_view_comments',
        'fv_location_noise_level',
        'fv_location_noise_source',
      ],
    },
  ],

  // 9 · Unit capacity
  '9': [
    {
      id: 'p9_capacity',
      label:
        'Describe capacity — base beds, maximum including sofa beds or extras, the bed setup, and any comments.',
      target_slugs: [
        'fv_capacity_base',
        'fv_capacity_max',
        'fv_capacity_actual_setup',
        'fv_capacity_comments',
      ],
    },
  ],

  // 11 · Unit condition, appliances & amenities
  '11': [
    {
      id: 'p11_condition',
      label:
        'How is the unit overall — is it furnished to Arbio standard, the equipment status, and the bathroom condition?',
      target_slugs: ['fv_furniture_status', 'fv_equipment_status', 'fv_bathroom_condition'],
    },
    {
      id: 'p11_items',
      label:
        'Are there appliances or amenities to log? Go item by item — its name, kind, brand, where it is, how to use it, and its availability type.',
      target_slugs: [
        'fv_items_to_log',
        'item_name',
        'item_kind',
        'item_brand',
        'item_location',
        'item_instructions',
        'item_availability_type',
      ],
    },
  ],

  // 12 · Unit safety equipment
  '12': [
    {
      id: 'p12_fusebox',
      label: 'Is there a fuse box in the unit? If so, where is it and how is it reset.',
      target_slugs: [
        'fv_unit_fusebox_present',
        'fv_unit_fusebox_location',
        'fv_unit_fusebox_reset_instructions',
      ],
    },
    {
      id: 'p12_detectors',
      label:
        'Run through the safety equipment — fire extinguisher (present, where, service date), smoke detector (present and working), carbon monoxide detector (present and working), and a first-aid kit (present and where).',
      target_slugs: [
        'fv_fire_extinguisher_present',
        'fv_fire_extinguisher_location',
        'fv_fire_extinguisher_service_date',
        'fv_smoke_detector_present',
        'fv_smoke_detector_working',
        'fv_co_detector_present',
        'fv_co_detector_working',
        'fv_first_aid_present',
        'fv_first_aid_location',
      ],
    },
  ],

  // 13 · Unit amenities & details — no voice prompt: fv_blackout_curtains is a
  // single select, faster to tap than to dictate.

  // 15 · Final assessment / readiness
  '15': [
    {
      id: 'p15_readiness',
      label:
        'Give your final assessment — overall readiness for go-live, a health score from one to ten, your summary recommendation, and any general comments or flags.',
      target_slugs: [
        'fv_readiness_overall',
        'fv_readiness_health_score',
        'fv_readiness_recommendation_summary',
        'fv_general_comments',
      ],
    },
  ],

  // 16 · Building condition & issues
  '16': [
    {
      id: 'p16_issues',
      label:
        'Go issue by issue — for each: what it is, the type, the area of the building, how to resolve it, quantity, rough cost, how urgent, and any notes.',
      target_slugs: [
        'prop_issue_name',
        'prop_issue_type',
        'prop_issue_area',
        'prop_issue_resolution',
        'prop_issue_quantity',
        'prop_issue_cost_estimate_eur',
        'prop_issue_urgency',
        'prop_issue_notes',
      ],
    },
  ],

  // 17 · Unit issue log
  '17': [
    {
      id: 'p17_issues',
      label:
        'Are there any issues in the unit? If so, go issue by issue — for each: what it is, the type, where in the unit, how to resolve it, quantity, rough cost, how urgent, and any notes.',
      target_slugs: [
        'fv_issues_found',
        'issue_name',
        'issue_type',
        'issue_location',
        'issue_resolution',
        'issue_quantity',
        'issue_cost_estimate_eur',
        'issue_urgency',
        'issue_notes',
      ],
    },
  ],

  // 18 · Unit check-in — apartment door
  '18': [
    {
      id: 'p18_checkin_step',
      label:
        'Walk through the apartment door check-in — the step name, the lock type and provider, the lock brand, whether it is primary or backup, and how keys are stored.',
      target_slugs: [
        'unit_step_name',
        'unit_step_lock_type',
        'unit_step_smart_lock_provider',
        'unit_step_lock_brand',
        'unit_step_lock_classification',
        'unit_step_key_storage_method',
        'unit_step_storage_brand',
      ],
    },
  ],
};

export function promptsForPhase(phaseId: string): SectionPrompt[] {
  return SECTION_VOICE_PROMPTS[phaseId] ?? [];
}

// Synthetic answer slug under which a prompt's qualitative voice summary is
// stored (hub-only, no PMS target). question_key = this, area_key = phase id.
// Mirrors the existing `${slug}__follow_up` synthetic-key convention.
export function voiceSummarySlug(promptId: string): string {
  return `${promptId}__summary`;
}
